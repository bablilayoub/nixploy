/**
 * Extra Traefik entrypoints for layer-4 (TCP/UDP) routing.
 *
 * Two things have to agree before a `tcp`/`udp` domain can work:
 *
 * 1. Traefik's **static** config must declare the entrypoint. The static file
 *    is read once at process start — the file provider only hot-reloads the
 *    *dynamic* directory — so a new entrypoint means restarting the proxy.
 * 2. The `nixploy-traefik` swarm service must publish the port on the host.
 *
 * Both are done in ONE `docker service update`: the published-port change
 * recreates the Traefik task anyway, and that recreation is what makes it
 * re-read the static config. It costs a short proxy outage (~9 s measured on
 * the local swarm), so entrypoint writes are instance-admin only and the
 * panel warns before saving.
 *
 * Rows live in `traefik_entrypoint` and are instance-level, not per tenant:
 * host ports are a single shared namespace.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { domains, traefikEntrypoints } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { assertSafePublishedPort } from "../../utils/validators";
import { badRequest, conflict } from "../errors";
import { assertEntrypointName, writeFileOnServer } from "./config-writer";
import { getTraefikDir, REMOTE_TRAEFIK_DIR } from "./paths";

export type EntrypointProtocol = "tcp" | "udp";

/** One `traefik_entrypoint` row, as consumed by the renderers below. */
export interface TraefikEntrypointSpec {
	name: string;
	port: number;
	protocol: EntrypointProtocol;
}

/** Entrypoints Traefik always has from the shipped static config. */
export const BUILTIN_ENTRYPOINT_PORTS: ReadonlySet<number> = new Set([80, 443]);

/** Run a shell command on the Nixploy host or a managed server. */
const runOn = (serverId: string | null | undefined, command: string): Promise<string> =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

/**
 * Validate one entrypoint before it is stored or rendered. The name lands
 * verbatim in YAML and the port is opened on every host interface (swarm
 * host-mode publishing has no `127.0.0.1:` form), so both go through the same
 * guards a tenant-published port does.
 */
export const assertValidEntrypoint = (input: {
	name: string;
	port: number;
	protocol: EntrypointProtocol;
}): TraefikEntrypointSpec => {
	const name = assertEntrypointName(input.name);
	assertSafePublishedPort(input.port, "entrypoint port");
	if (BUILTIN_ENTRYPOINT_PORTS.has(input.port)) {
		throw badRequest(`Port ${input.port} is already served by Traefik's web/websecure entrypoint`);
	}
	if (input.protocol !== "tcp" && input.protocol !== "udp") {
		throw badRequest("Entrypoint protocol must be tcp or udp");
	}
	return { name, port: input.port, protocol: input.protocol };
};

/** Every configured entrypoint, in a stable order (rendering is diffed). */
export const loadTraefikEntrypoints = async (): Promise<TraefikEntrypointSpec[]> => {
	const rows = await db
		.select()
		.from(traefikEntrypoints)
		.orderBy(asc(traefikEntrypoints.port), asc(traefikEntrypoints.protocol));
	return rows.map((row) => ({
		name: row.name,
		port: row.port,
		protocol: row.protocol as EntrypointProtocol,
	}));
};

/**
 * The `entryPoints:` block lines for the extra entrypoints, appended after
 * `web`/`websecure` by {@link buildTraefikStaticConfig}. Empty string when
 * there are none, so the rendered file stays byte-identical to
 * `docker/traefik/traefik.yml` on an instance that never used layer-4
 * routing (CI diffs them).
 *
 * Traefik's address syntax defaults to TCP, so only UDP carries an explicit
 * protocol suffix.
 */
export const renderEntrypointsYaml = (entrypoints: readonly TraefikEntrypointSpec[]): string =>
	entrypoints
		.map((entry) => {
			const name = assertEntrypointName(entry.name);
			assertSafePublishedPort(entry.port, "entrypoint port");
			const suffix = entry.protocol === "udp" ? "/udp" : "";
			return `  ${name}:\n    address: ":${entry.port}${suffix}"\n`;
		})
		.join("");

/** A published port as `docker service inspect` reports it. */
export interface PublishedPort {
	targetPort: number;
	publishedPort: number;
	protocol: string;
	/** `host` (what Nixploy publishes) or `ingress`; needed to remove it again. */
	publishMode?: string;
}

/**
 * Published ports the Traefik service should have: the two built-ins plus one
 * host-mode mapping per entrypoint (`published == target`, so the port a user
 * dials is the port Traefik listens on inside the container).
 */
export const desiredPublishedPorts = (
	entrypoints: readonly TraefikEntrypointSpec[],
): PublishedPort[] =>
	[
		{ targetPort: 80, publishedPort: 80, protocol: "tcp" },
		{ targetPort: 443, publishedPort: 443, protocol: "tcp" },
		...entrypoints.map((entry) => ({
			targetPort: entry.port,
			publishedPort: entry.port,
			protocol: entry.protocol,
		})),
	].map((port) => ({ ...port, publishMode: "host" }));

const portKey = (port: PublishedPort): string => `${port.publishedPort}/${port.protocol}`;

/**
 * `docker service update` flags that turn `current` into `desired`. The
 * built-in 80/443 mappings are never removed even if the running service is
 * missing them — that would be an unrelated hand-edit and dropping HTTP
 * traffic to "fix" it is worse than leaving it alone.
 */
export const buildPublishUpdateArgs = (
	current: readonly PublishedPort[],
	desired: readonly PublishedPort[],
): string[] => {
	const currentKeys = new Set(current.map(portKey));
	const desiredKeys = new Set(desired.map(portKey));
	const args: string[] = [];
	for (const port of desired) {
		if (currentKeys.has(portKey(port))) continue;
		args.push(
			`--publish-add published=${port.publishedPort},target=${port.targetPort},protocol=${port.protocol},mode=host`,
		);
	}
	for (const port of current) {
		if (desiredKeys.has(portKey(port))) continue;
		if (BUILTIN_ENTRYPOINT_PORTS.has(port.publishedPort)) continue;
		// The documented short form (`--publish-rm <target>/<proto>`) silently
		// matches nothing for a **host-mode** port — `docker service update`
		// exits 0 and leaves the port published (verified on Docker 29.7).
		// The full port spec, mirroring how it was added, does remove it.
		args.push(
			`--publish-rm published=${port.publishedPort},target=${port.targetPort},protocol=${port.protocol},mode=${port.publishMode ?? "host"}`,
		);
	}
	return args;
};

/** Ports the running `nixploy-traefik` service publishes right now. */
const readPublishedPorts = async (
	serverId: string | null | undefined,
	serviceName: string,
): Promise<PublishedPort[]> => {
	const raw = await runOn(
		serverId,
		`docker service inspect ${serviceName} --format '{{json .Spec.EndpointSpec.Ports}}' 2>/dev/null || true`,
	);
	const trimmed = raw.trim();
	if (!trimmed || trimmed === "null" || trimmed === "<no value>") return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((entry) => {
		const row = entry as {
			TargetPort?: number;
			PublishedPort?: number;
			Protocol?: string;
			PublishMode?: string;
		};
		if (typeof row.PublishedPort !== "number" || typeof row.TargetPort !== "number") return [];
		return [
			{
				targetPort: row.TargetPort,
				publishedPort: row.PublishedPort,
				protocol: (row.Protocol ?? "tcp").toLowerCase(),
				publishMode: (row.PublishMode ?? "host").toLowerCase(),
			},
		];
	});
};

/** Host-side path of the static config on the target. */
const staticConfigPath = (serverId?: string | null): string =>
	`${serverId ? REMOTE_TRAEFIK_DIR : getTraefikDir()}/traefik.yml`;

export interface ApplyEntrypointsResult {
	/** Entrypoints now declared in the static config. */
	entrypoints: TraefikEntrypointSpec[];
	/** `docker service update` flags that were issued (empty = ports unchanged). */
	publishArgs: string[];
	/** Whether the Traefik task was recreated (and the proxy briefly unavailable). */
	restarted: boolean;
	/** False when `nixploy-traefik` is not running here (dev panels, remote-only). */
	serviceUpdated: boolean;
}

/**
 * Reconcile Traefik with the `traefik_entrypoint` table: rewrite the static
 * config, then publish/unpublish the ports and restart the proxy in one
 * `docker service update`.
 *
 * Callers are mutations on the entrypoint router, which already warned the
 * admin about the outage. When the proxy service does not exist (a dev panel
 * booted with `NIXPLOY_DISABLE_TRAEFIK_BOOT=1`) only the file is written and
 * `serviceUpdated` is false — the next `ensureTraefikSetup` creates the
 * service with the right ports.
 */
export const applyTraefikEntrypoints = async (
	serverId?: string | null,
): Promise<ApplyEntrypointsResult> => {
	// Imported lazily: `setup.ts` renders the entrypoints with
	// `renderEntrypointsYaml` from this module, so a static import here would
	// close the cycle at module-evaluation time.
	const { buildTraefikStaticConfig, getAcmeSettings, TRAEFIK_SERVICE_NAME } = await import(
		"./setup"
	);
	const entrypoints = await loadTraefikEntrypoints();
	const acme = await getAcmeSettings();
	const staticConfig = buildTraefikStaticConfig(acme.email, acme.dns, entrypoints);
	await writeFileOnServer(staticConfigPath(serverId), staticConfig, serverId);

	const current = await readPublishedPorts(serverId, TRAEFIK_SERVICE_NAME);
	if (current.length === 0) {
		// No service (or an unreadable spec): nothing safe to update in place.
		return { entrypoints, publishArgs: [], restarted: false, serviceUpdated: false };
	}
	const publishArgs = buildPublishUpdateArgs(current, desiredPublishedPorts(entrypoints));
	// `--force` recreates the task even when no port changed, which is the
	// only way a static-config edit reaches the running proxy.
	await runOn(
		serverId,
		["docker service update", "--detach", "--force", ...publishArgs, TRAEFIK_SERVICE_NAME].join(
			" ",
		),
	);
	return { entrypoints, publishArgs, restarted: true, serviceUpdated: true };
};

/**
 * Refuse to delete an entrypoint that domains still route through — the rows
 * would render `entryPoints: [gone]` and Traefik would drop those routers.
 */
export const assertEntrypointUnused = async (name: string): Promise<void> => {
	const rows = await db
		.select({ host: domains.host })
		.from(domains)
		.where(eq(domains.entrypoint, name))
		.limit(1);
	if (rows.length > 0) {
		throw conflict(
			`Entrypoint "${name}" is still used by domain ${rows[0]?.host}. Remove the domain first.`,
		);
	}
};
