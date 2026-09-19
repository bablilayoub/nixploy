import { resolve4, resolve6 } from "node:dns/promises";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { eq } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import { db } from "../../db";
import { domains } from "../../db/schema";
import { execAsync } from "../../utils/exec";
import { getSwarmNetwork } from "../application/paths";
import { detectPublicIp } from "../cluster/public-host";
import { traefikAppName } from "../compose/commands";
import { getDocker } from "../deployment/docker";
import { shellQuote } from "../deployment/paths";
import { notFound } from "../errors";
import { readAcmeCertificates } from "../monitoring/platform-alerts";
import { composePreviewTraefikKey } from "../preview/traefik";
import { getDynamicDir } from "./paths";

/**
 * The deterministic route diagnostician: why does this domain answer 502 /
 * 404 / nothing? No model, no guessing — the same checks an operator runs
 * by hand, in the order the request travels, each with the fix.
 *
 *   DNS → the route file → a second file claiming the host → the upstream
 *   task → the shared network → the port → Traefik's own answer → the
 *   certificate
 *
 * Every probe degrades to "could not check" rather than aborting the
 * diagnosis: a missing busybox image or an unreachable Docker socket is a
 * finding, not a crash.
 */

export type FindingStatus = "ok" | "warn" | "fail" | "skip";

export interface DomainFinding {
	id: string;
	status: FindingStatus;
	title: string;
	detail: string;
	/** What to do about it, when there is something to do. */
	fix?: string;
}

export type DomainVerdict = "healthy" | "degraded" | "broken";

export interface DomainDiagnosis {
	host: string;
	verdict: DomainVerdict;
	findings: DomainFinding[];
	checkedAt: string;
}

// ── pure helpers (tested) ───────────────────────────────────────────────────

/** Does this dynamic-config document carry an HTTP router for the host? */
export function fileRoutesHost(document: unknown, host: string): boolean {
	const routers = (document as { http?: { routers?: Record<string, { rule?: unknown }> } })?.http
		?.routers;
	if (!routers || typeof routers !== "object") return false;
	const needle = `\`${host.toLowerCase()}\``;
	return Object.values(routers).some(
		(router) => typeof router?.rule === "string" && router.rule.toLowerCase().includes(needle),
	);
}

/** One verdict from the findings: any failure is broken, any warning degraded. */
export function verdictOf(findings: readonly DomainFinding[]): DomainVerdict {
	if (findings.some((finding) => finding.status === "fail")) return "broken";
	if (findings.some((finding) => finding.status === "warn")) return "degraded";
	return "healthy";
}

/**
 * What Traefik's own answer means. 404 with the default "404 page not found"
 * body is Traefik saying it has no router for the host; 502/503 is a router
 * that found no healthy server; anything else reached the application.
 */
export function interpretProxyAnswer(
	status: number | null,
	error: string | null,
): Pick<DomainFinding, "status" | "title" | "detail" | "fix"> {
	if (status === null) {
		return {
			status: "skip",
			title: "Traefik could not be reached from the panel",
			detail: error ?? "No answer.",
		};
	}
	if (status === 404) {
		return {
			status: "fail",
			title: "Traefik answers 404 for this host",
			detail:
				"Traefik has no router for the host: the dynamic file is missing, not loaded yet, or its rule does not match.",
			fix: "Save the domain again to rewrite the file; check the Traefik logs for a YAML the file provider refused.",
		};
	}
	if (status === 502 || status === 503) {
		return {
			status: "fail",
			title: `Traefik answers ${status} for this host`,
			detail:
				"The router exists but no server behind it answered: the task is down, not on the shared network, or listening on another port.",
			fix: "See the upstream, network and port findings below.",
		};
	}
	if (status >= 500) {
		return {
			status: "warn",
			title: `The application answers ${status}`,
			detail: "The route works; the application itself returned a server error.",
		};
	}
	return {
		status: "ok",
		title: `Traefik routes the host (HTTP ${status})`,
		detail: "",
	};
}

// ── probes ──────────────────────────────────────────────────────────────────

interface RouteTarget {
	/** Traefik file key (`<dynamic>/<key>.yml`). */
	key: string;
	/** Swarm service to inspect, or null for an external upstream / a compose container lookup. */
	swarmService: string | null;
	/** Compose: labels identifying the routed container. */
	composeLabels: string[] | null;
	/** Upstream name Traefik dials (a Swarm/compose DNS name) and port; null for external origins. */
	upstream: { host: string; port: number } | null;
	external: boolean;
}

async function loadTarget(domainId: string): Promise<{
	domain: typeof domains.$inferSelect;
	target: RouteTarget;
}> {
	const domain = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: { application: true, compose: true, externalUpstream: true, previewDeployment: true },
	});
	if (!domain) throw notFound("Domain not found");
	const port = domain.port ?? 80;
	if (domain.externalUpstream) {
		return {
			domain,
			target: {
				key: domain.externalUpstream.appName,
				swarmService: null,
				composeLabels: null,
				upstream: null,
				external: true,
			},
		};
	}
	if (domain.previewDeployment) {
		const preview = domain.previewDeployment;
		if (domain.compose && domain.serviceName) {
			const key = composePreviewTraefikKey(
				domain.compose.composeType,
				preview.appName,
				domain.serviceName,
			);
			return {
				domain,
				target: {
					key: preview.appName,
					swarmService: null,
					composeLabels: [
						`com.docker.compose.project=${preview.appName}`,
						`com.docker.compose.service=${domain.serviceName}`,
					],
					upstream: { host: key, port },
					external: false,
				},
			};
		}
		return {
			domain,
			target: {
				key: preview.appName,
				swarmService: preview.appName,
				composeLabels: null,
				upstream: { host: preview.appName, port },
				external: false,
			},
		};
	}
	if (domain.compose && domain.serviceName) {
		const key = traefikAppName(domain.compose, domain.serviceName);
		return {
			domain,
			target: {
				key,
				swarmService: domain.compose.composeType === "stack" ? key : null,
				composeLabels:
					domain.compose.composeType === "stack"
						? [`com.docker.swarm.service.name=${key}`]
						: [
								`com.docker.compose.project=${domain.compose.appName}`,
								`com.docker.compose.service=${domain.serviceName}`,
							],
				upstream: { host: key, port },
				external: false,
			},
		};
	}
	if (domain.application) {
		return {
			domain,
			target: {
				key: domain.application.appName,
				swarmService: domain.application.appName,
				composeLabels: null,
				upstream: { host: domain.application.appName, port },
				external: false,
			},
		};
	}
	throw notFound("Domain has no parent");
}

async function probeDns(host: string): Promise<DomainFinding> {
	const bare = host.startsWith("*.") ? host.slice(2) : host;
	if (bare.endsWith(".traefik.me") || bare === "traefik.me") {
		return {
			id: "dns",
			status: "ok",
			title: "traefik.me host (resolves to 127.0.0.1 by design)",
			detail: "Only reachable from this machine.",
		};
	}
	const [v4, v6, serverIp] = await Promise.all([
		resolve4(bare).catch(() => [] as string[]),
		resolve6(bare).catch(() => [] as string[]),
		detectPublicIp().catch(() => null),
	]);
	const resolved = [...v4, ...v6];
	if (resolved.length === 0) {
		return {
			id: "dns",
			status: "fail",
			title: `${bare} does not resolve`,
			detail: "No A or AAAA record.",
			fix: `Create an A record for ${bare} pointing at ${serverIp ?? "this server's public IP"}.`,
		};
	}
	if (serverIp && !v4.includes(serverIp)) {
		return {
			id: "dns",
			status: "warn",
			title: `${bare} resolves elsewhere`,
			detail: `Resolves to ${resolved.join(", ")}; this server is ${serverIp}.`,
			fix: "Fine behind a CDN or a load balancer; otherwise point the record here.",
		};
	}
	return {
		id: "dns",
		status: "ok",
		title: `${bare} resolves to this server`,
		detail: resolved.join(", "),
	};
}

async function probeRouteFile(key: string, host: string): Promise<DomainFinding> {
	const file = path.join(getDynamicDir(), `${key}.yml`);
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return {
			id: "file",
			status: "fail",
			title: `Route file ${key}.yml is missing`,
			detail: `Expected under ${getDynamicDir()}.`,
			fix: "Save the domain again (any edit) to rewrite it; for a compose stack, redeploy.",
		};
	}
	let document: unknown;
	try {
		document = parseYaml(raw);
	} catch (error) {
		return {
			id: "file",
			status: "fail",
			title: `Route file ${key}.yml is not valid YAML`,
			detail: error instanceof Error ? error.message : String(error),
			fix: "Save the domain again to rewrite it.",
		};
	}
	if (!fileRoutesHost(document, host)) {
		return {
			id: "file",
			status: "fail",
			title: `Route file ${key}.yml has no router for ${host}`,
			detail: "The file exists but its rules do not mention this host.",
			fix: "Save the domain again to rewrite the file.",
		};
	}
	return { id: "file", status: "ok", title: `Route file ${key}.yml routes ${host}`, detail: "" };
}

async function probeConflicts(key: string, host: string): Promise<DomainFinding> {
	const dir = getDynamicDir();
	let names: string[];
	try {
		names = (await readdir(dir)).filter((name) => name.endsWith(".yml") && name !== `${key}.yml`);
	} catch {
		return {
			id: "conflicts",
			status: "skip",
			title: "Could not list the dynamic directory",
			detail: "",
		};
	}
	const others: string[] = [];
	for (const name of names) {
		const raw = await readFile(path.join(dir, name), "utf8").catch(() => "");
		if (!raw.toLowerCase().includes(`\`${host.toLowerCase()}\``)) continue;
		try {
			if (fileRoutesHost(parseYaml(raw), host)) others.push(name);
		} catch {
			// a broken file is someone else's finding
		}
	}
	if (others.length > 0) {
		return {
			id: "conflicts",
			status: "warn",
			title: `${others.length} other file${others.length === 1 ? "" : "s"} also route${others.length === 1 ? "s" : ""} ${host}`,
			detail: others.join(", "),
			fix: "Traefik picks one nondeterministically. Remove the stale domain (or the stale file) so exactly one remains.",
		};
	}
	return { id: "conflicts", status: "ok", title: "No other file claims the host", detail: "" };
}

async function probeUpstreamTask(target: RouteTarget): Promise<DomainFinding> {
	if (target.external) {
		return {
			id: "upstream",
			status: "skip",
			title: "External upstream",
			detail: "Nixploy does not run this origin.",
		};
	}
	try {
		const docker = await getDocker();
		if (target.swarmService) {
			const tasks = (await docker.listTasks({
				filters: { service: [target.swarmService], "desired-state": ["running"] },
			})) as Array<{ Status?: { State?: string; Err?: string } }>;
			const running = tasks.filter((task) => task.Status?.State === "running").length;
			if (tasks.length === 0) {
				return {
					id: "upstream",
					status: "fail",
					title: `Swarm service ${target.swarmService} has no task`,
					detail: "The service is stopped, scaled to 0, or was never deployed.",
					fix: "Deploy or start the service.",
				};
			}
			if (running === 0) {
				const err = tasks.map((task) => task.Status?.Err).find(Boolean);
				return {
					id: "upstream",
					status: "fail",
					title: `Swarm service ${target.swarmService}: ${tasks.length} task${tasks.length === 1 ? "" : "s"}, none running`,
					detail: err ? `Last task error: ${err}` : "Tasks are starting, failing or pending.",
					fix: "Check the service's Events and Logs tabs.",
				};
			}
			return {
				id: "upstream",
				status: "ok",
				title: `${running} task${running === 1 ? "" : "s"} running for ${target.swarmService}`,
				detail: "",
			};
		}
		if (target.composeLabels) {
			const containers = await docker.listContainers({ filters: { label: target.composeLabels } });
			if (containers.length === 0) {
				return {
					id: "upstream",
					status: "fail",
					title: "No running container for the routed compose service",
					detail: `Looked for ${target.composeLabels.join(" + ")}.`,
					fix: "Deploy the stack, or check that the service name on the domain matches the compose file.",
				};
			}
			return {
				id: "upstream",
				status: "ok",
				title: `${containers.length} container${containers.length === 1 ? "" : "s"} running for the routed service`,
				detail: "",
			};
		}
		return { id: "upstream", status: "skip", title: "Nothing to inspect", detail: "" };
	} catch (error) {
		return {
			id: "upstream",
			status: "skip",
			title: "Could not inspect the upstream",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

async function probeSharedNetwork(target: RouteTarget): Promise<DomainFinding> {
	if (target.external) {
		return { id: "network", status: "skip", title: "External upstream", detail: "" };
	}
	const shared = getSwarmNetwork();
	try {
		const docker = await getDocker();
		if (target.swarmService) {
			const service = (await docker
				.getService(target.swarmService)
				.inspect()
				.catch(() => null)) as {
				Spec?: { TaskTemplate?: { Networks?: Array<{ Target?: string }> } };
			} | null;
			if (!service) {
				return { id: "network", status: "skip", title: "Service not found", detail: "" };
			}
			const sharedId = await docker
				.getNetwork(shared)
				.inspect()
				.then((network: { Id?: string }) => network.Id ?? null)
				.catch(() => null);
			const attached = (service.Spec?.TaskTemplate?.Networks ?? []).some(
				(entry) => entry.Target === shared || (sharedId !== null && entry.Target === sharedId),
			);
			return attached
				? { id: "network", status: "ok", title: `Attached to ${shared}`, detail: "" }
				: {
						id: "network",
						status: "fail",
						title: `Not attached to ${shared}`,
						detail:
							"Traefik can only reach services on the shared overlay; a service joins it when its first domain is saved.",
						fix: "Save the domain again to reattach, or redeploy the service.",
					};
		}
		if (target.composeLabels) {
			const containers = await docker.listContainers({ filters: { label: target.composeLabels } });
			const first = containers[0];
			if (!first)
				return { id: "network", status: "skip", title: "No container to inspect", detail: "" };
			const attached = Object.keys(first.NetworkSettings?.Networks ?? {}).includes(shared);
			return attached
				? { id: "network", status: "ok", title: `Container attached to ${shared}`, detail: "" }
				: {
						id: "network",
						status: "fail",
						title: `Container not attached to ${shared}`,
						detail:
							"The compose render attaches only the routed services; the file may predate the domain.",
						fix: "Redeploy the stack.",
					};
		}
		return { id: "network", status: "skip", title: "Nothing to inspect", detail: "" };
	} catch (error) {
		return {
			id: "network",
			status: "skip",
			title: "Could not inspect the network",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A throwaway busybox on the shared overlay: does anything listen on host:port? */
async function probePort(target: RouteTarget): Promise<DomainFinding> {
	if (!target.upstream) {
		return { id: "port", status: "skip", title: "External upstream", detail: "" };
	}
	const { host, port } = target.upstream;
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host)) {
		return { id: "port", status: "skip", title: "Unsafe upstream name", detail: host };
	}
	try {
		await execAsync(
			`docker run --rm --network ${shellQuote(getSwarmNetwork())} --entrypoint nc busybox:stable -z -w 5 ${shellQuote(host)} ${port}`,
			{ timeout: 30_000 },
		);
		return { id: "port", status: "ok", title: `${host}:${port} accepts connections`, detail: "" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			/No such image|pull access|manifest unknown|TLS handshake|network is unreachable/i.test(
				message,
			)
		) {
			return {
				id: "port",
				status: "skip",
				title: "Could not run the port probe",
				detail: message.split("\n")[0] ?? message,
			};
		}
		return {
			id: "port",
			status: "fail",
			title: `${host}:${port} refuses connections on the shared network`,
			detail:
				"The name does not resolve on the overlay, or nothing listens on that port inside the container.",
			fix: `Check the container port on the domain (${port}) against what the application listens on, and that the process binds 0.0.0.0, not 127.0.0.1.`,
		};
	}
}

const proxyRequest = (options: {
	hostname: string;
	port: number;
	tls: boolean;
	hostHeader: string;
	path: string;
}): Promise<number> =>
	new Promise((resolve, reject) => {
		const lib = options.tls ? https : http;
		const request = lib.request(
			{
				hostname: options.hostname,
				port: options.port,
				path: options.path,
				method: "GET",
				headers: { Host: options.hostHeader, "User-Agent": "nixploy-diagnose" },
				timeout: 8_000,
				...(options.tls ? { servername: options.hostHeader, rejectUnauthorized: false } : {}),
			},
			(response) => {
				response.resume();
				resolve(response.statusCode ?? 0);
			},
		);
		request.on("timeout", () => request.destroy(new Error("timed out")));
		request.on("error", reject);
		request.end();
	});

/** Traefik's own answer for the host, as a request from the panel with the Host header set. */
async function probeProxy(
	host: string,
	https: boolean,
	pathPrefix: string | null,
): Promise<DomainFinding> {
	const candidates = process.env.NIXPLOY_TRAEFIK_INTERNAL_HOST
		? [process.env.NIXPLOY_TRAEFIK_INTERNAL_HOST]
		: ["nixploy-traefik", "127.0.0.1"];
	const requestPath = pathPrefix && pathPrefix !== "/" ? pathPrefix : "/";
	let lastError: string | null = null;
	for (const hostname of candidates) {
		try {
			const status = await proxyRequest({
				hostname,
				port: https ? 443 : 80,
				tls: https,
				hostHeader: host.startsWith("*.") ? `probe.${host.slice(2)}` : host,
				path: requestPath,
			});
			return { id: "proxy", ...interpretProxyAnswer(status, null) };
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	return { id: "proxy", ...interpretProxyAnswer(null, lastError) };
}

async function probeCertificate(domain: typeof domains.$inferSelect): Promise<DomainFinding> {
	if (domain.certificateType !== "letsencrypt") {
		return {
			id: "certificate",
			status: "skip",
			title:
				domain.certificateType === "custom"
					? "Custom certificate"
					: "No certificate requested (Traefik's self-signed default)",
			detail: "",
		};
	}
	const certificates = await readAcmeCertificates().catch(() => [] as Array<{ domain: string }>);
	const wanted = domain.host.toLowerCase();
	const found = certificates.some((entry) => entry.domain.toLowerCase() === wanted);
	return found
		? { id: "certificate", status: "ok", title: "Let's Encrypt certificate issued", detail: "" }
		: {
				id: "certificate",
				status: "warn",
				title: "No Let's Encrypt certificate in acme.json yet",
				detail:
					"Issued on the first HTTPS request once the host resolves here and :80 is reachable for HTTP-01 (DNS-01 for wildcards).",
				fix: "Fix DNS first if it fails above; then open the host over https once. See docs/troubleshooting.md → Certificate stuck.",
			};
}

/** Run every probe for one domain. Never throws for a probe; only for a missing domain. */
export async function diagnoseDomain(domainId: string): Promise<DomainDiagnosis> {
	const { domain, target } = await loadTarget(domainId);
	const host = domain.host;
	const layer4 = (domain.protocol ?? "http") !== "http";
	const findings: DomainFinding[] = [];
	findings.push(await probeDns(host));
	findings.push(await probeRouteFile(target.key, host));
	findings.push(await probeConflicts(target.key, host));
	findings.push(await probeUpstreamTask(target));
	findings.push(await probeSharedNetwork(target));
	if (layer4) {
		findings.push({
			id: "port",
			status: "skip",
			title: "Layer-4 route",
			detail: "TCP/UDP routers are not probed.",
		});
		findings.push({ id: "proxy", status: "skip", title: "Layer-4 route", detail: "" });
	} else {
		findings.push(await probePort(target));
		findings.push(await probeProxy(host, domain.https, domain.path));
	}
	findings.push(await probeCertificate(domain));
	return { host, verdict: verdictOf(findings), findings, checkedAt: new Date().toISOString() };
}
