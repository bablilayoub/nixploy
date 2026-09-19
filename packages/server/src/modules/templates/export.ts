import { listComposeServices, parseComposeFile } from "../compose/compose-file";
import { isSecretBuildArgKey } from "../deployment/builders/build-env";
import { parseEnv } from "../deployment/env";
import { badRequest } from "../errors";
import { remoteTemplateSchema } from "./schema";
import type { Template } from "./types";

/** The compose columns the export reads — a `ComposeRow` satisfies it. */
export interface ExportableCompose {
	name: string;
	appName: string;
	description: string | null;
	composeFile: string;
	sourceType: string;
	env: string | null;
	hostPrivileged: boolean;
}

/** A domain of the stack: which compose service it routes to and on which port. */
export interface ExportDomain {
	host: string;
	serviceName: string | null;
	port: number | null;
	https: boolean;
}

export interface ExportedTemplate {
	template: Template;
	/** What was rewritten on the way out, one line each — shown next to the download. */
	notes: string[];
}

/**
 * Turn a running compose service into a `Template` another instance can
 * serve from a template source (`docs/templates.md`). The output is the
 * exact remote shape — validated with `remoteTemplateSchema` before it is
 * returned — so a file written by this never fails a sync.
 *
 * Three rewrites, each reported in `notes`:
 * - a secret-shaped env key (`isSecretBuildArgKey`: PASSWORD, TOKEN, KEY, …)
 *   gets `{{generateSecret}}` as its default — a template is for
 *   redistribution, and a real credential must never leave in one;
 * - a value that is one of the stack's own hostnames (bare or as a URL)
 *   becomes `{{domain}}` (URL scheme kept), so a `BASE_URL` is right on the
 *   first deploy elsewhere;
 * - everything else is kept verbatim as the default: those are the sane
 *   values the operator already chose.
 *
 * The suggested domain is the stack's first routed HTTP domain; without one,
 * the first service that exposes a port; failing that, the first service on
 * port 80. Refused: a git-backed service (the file lives in the repository,
 * not on the row) and a host-privileged one (a remote source cannot carry
 * `hostPrivileged`, so the export would fail the safety check on sync).
 */
export function exportComposeAsTemplate(
	row: ExportableCompose,
	domains: readonly ExportDomain[],
): ExportedTemplate {
	if (row.sourceType !== "raw" || !row.composeFile.trim()) {
		throw badRequest(
			"Only a compose service with its file stored on the service (raw source) can be exported — a git-backed stack's file lives in the repository",
		);
	}
	if (row.hostPrivileged) {
		throw badRequest(
			"This stack uses host-privileged options a template source cannot carry (hostPrivileged is an instance-admin decision about the built-in catalog)",
		);
	}
	const spec = parseComposeFile(row.composeFile);
	const serviceNames = listComposeServices(row.composeFile);
	const firstService = serviceNames[0];
	if (!firstService) {
		throw badRequest("The compose file defines no services");
	}

	const notes: string[] = [];
	const hosts = domains.map((domain) => domain.host.toLowerCase()).filter(Boolean);
	const env = parseEnv(row.env).map(([key, value]) => {
		if (isSecretBuildArgKey(key)) {
			notes.push(`${key}: value replaced with {{generateSecret}}`);
			return { key, default: "{{generateSecret}}", description: "" };
		}
		const rewritten = rewriteDomainValue(value, hosts);
		if (rewritten !== value) {
			notes.push(`${key}: ${value} → ${rewritten}`);
		}
		return { key, default: rewritten, description: "" };
	});

	const routed = domains.find(
		(domain) => domain.serviceName && serviceNames.includes(domain.serviceName),
	);
	const suggestedDomain = routed?.serviceName
		? { serviceName: routed.serviceName, port: routed.port ?? 80 }
		: (firstExposedPort(spec.services ?? {}, serviceNames) ?? {
				serviceName: firstService,
				port: 80,
			});
	if (!routed) {
		notes.push(
			`no routed domain on the stack — suggesting ${suggestedDomain.serviceName}:${suggestedDomain.port}`,
		);
	}

	const parsed = remoteTemplateSchema.safeParse({
		id: row.appName,
		name: row.name.slice(0, 120),
		description: (row.description ?? "").slice(0, 1024),
		logo: "",
		category: "Custom",
		tags: [],
		links: {},
		compose: row.composeFile,
		env,
		suggestedDomain,
	});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw badRequest(
			`This stack cannot be expressed as a template: ${issue ? `${issue.path.join(".") || "(root)"} ${issue.message}` : "invalid"}`,
		);
	}
	return { template: parsed.data, notes };
}

/** `https://shop.example.com/x` → `https://{{domain}}/x`; a bare host → `{{domain}}`. */
function rewriteDomainValue(value: string, hosts: readonly string[]): string {
	const trimmed = value.trim();
	if (!trimmed || hosts.length === 0) return value;
	const lower = trimmed.toLowerCase();
	for (const host of hosts) {
		if (lower === host) return "{{domain}}";
		const match = /^(https?:\/\/)([^/:]+)(.*)$/.exec(trimmed);
		if (match && match[2]?.toLowerCase() === host) {
			return `${match[1]}{{domain}}${match[3] ?? ""}`;
		}
	}
	return value;
}

/** The first service that publishes or exposes a port, with that container port. */
function firstExposedPort(
	services: Record<string, unknown>,
	order: readonly string[],
): { serviceName: string; port: number } | null {
	for (const serviceName of order) {
		const service = services[serviceName];
		if (!service || typeof service !== "object") continue;
		const { ports, expose } = service as { ports?: unknown; expose?: unknown };
		const port = firstPort(ports) ?? firstPort(expose);
		if (port) return { serviceName, port };
	}
	return null;
}

/** Container port of the first entry: `8080:80` → 80, `80` → 80, `{ target: 80 }` → 80. */
function firstPort(entries: unknown): number | null {
	if (!Array.isArray(entries)) return null;
	for (const entry of entries) {
		if (typeof entry === "number" && Number.isInteger(entry)) return entry;
		if (typeof entry === "string") {
			const container = entry.split(":").pop()?.split("/")[0]?.split("-")[0];
			const port = Number.parseInt(container ?? "", 10);
			if (Number.isInteger(port) && port > 0 && port < 65536) return port;
		}
		if (entry && typeof entry === "object" && "target" in entry) {
			const target = Number((entry as { target: unknown }).target);
			if (Number.isInteger(target) && target > 0 && target < 65536) return target;
		}
	}
	return null;
}
