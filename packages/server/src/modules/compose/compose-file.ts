import { parse, stringify } from "yaml";
import { NIXPLOY_NETWORK } from "./paths";

/**
 * Loose shape of a docker-compose / stack file. Only the keys this module
 * transforms are typed; everything else is passed through untouched.
 */
export interface ComposeServiceSpec {
	networks?: string[] | Record<string, { aliases?: string[] } & Record<string, unknown>>;
	depends_on?: string[] | Record<string, unknown>;
	links?: string[];
	[key: string]: unknown;
}

export interface ComposeFileSpec {
	services?: Record<string, ComposeServiceSpec>;
	networks?: Record<string, unknown>;
	[key: string]: unknown;
}

export function parseComposeFile(content: string): ComposeFileSpec {
	const spec = parse(content) as ComposeFileSpec | null;
	if (!spec || typeof spec !== "object") {
		throw new Error("Invalid compose file: not a YAML mapping");
	}
	if (!spec.services || Object.keys(spec.services).length === 0) {
		throw new Error("Invalid compose file: no services defined");
	}
	return spec;
}

/** Names of the services defined in a compose file. */
export function listComposeServices(content: string): string[] {
	const spec = parseComposeFile(content);
	return Object.keys(spec.services ?? {});
}

/**
 * Rename every service with a suffix (isolated deployments) and rewrite
 * intra-file references (`depends_on`, `links`) to the new names.
 */
export function randomizeServiceNames(spec: ComposeFileSpec, suffix: string): ComposeFileSpec {
	if (!suffix || !spec.services) return spec;
	const renamed: Record<string, ComposeServiceSpec> = {};
	for (const [name, service] of Object.entries(spec.services)) {
		renamed[`${name}-${suffix}`] = service;
	}
	for (const service of Object.values(renamed)) {
		if (Array.isArray(service.depends_on)) {
			service.depends_on = service.depends_on.map((dep) =>
				spec.services && dep in spec.services ? `${dep}-${suffix}` : dep,
			);
		} else if (service.depends_on && typeof service.depends_on === "object") {
			const next: Record<string, unknown> = {};
			for (const [dep, condition] of Object.entries(service.depends_on)) {
				next[spec.services && dep in spec.services ? `${dep}-${suffix}` : dep] = condition;
			}
			service.depends_on = next;
		}
		if (Array.isArray(service.links)) {
			service.links = service.links.map((link) => {
				const [target, ...rest] = link.split(":");
				const resolved =
					target && spec.services && target in spec.services ? `${target}-${suffix}` : target;
				return [resolved, ...rest].join(":");
			});
		}
	}
	return { ...spec, services: renamed };
}

/**
 * Attach every service to the shared `nixploy-network` overlay network so
 * Traefik can reach it. In `docker-compose` mode each service also gets the
 * alias `<appName>-<serviceName>` — that is the hostname Traefik routes to.
 * Stack mode relies on native swarm DNS (`<appName>_<serviceName>`).
 */
export function injectNetwork(
	spec: ComposeFileSpec,
	input: { appName: string; composeType: "docker-compose" | "stack" },
): ComposeFileSpec {
	const next: ComposeFileSpec = { ...spec };
	next.networks = {
		...next.networks,
		[NIXPLOY_NETWORK]: { external: true, name: NIXPLOY_NETWORK },
	};
	for (const [serviceName, service] of Object.entries(next.services ?? {})) {
		const alias = `${input.appName}-${serviceName}`;
		if (Array.isArray(service.networks)) {
			service.networks =
				input.composeType === "stack"
					? [...new Set([...service.networks, NIXPLOY_NETWORK])]
					: service.networks.filter((n) => n !== NIXPLOY_NETWORK);
			if (input.composeType === "docker-compose") {
				// convert to map form so the alias can be attached
				const asMap: Record<string, { aliases?: string[] } & Record<string, unknown>> = {};
				for (const n of service.networks) asMap[n] = {};
				asMap[NIXPLOY_NETWORK] = { aliases: [alias] };
				service.networks = asMap;
			}
		} else {
			const existing = service.networks ?? {};
			existing[NIXPLOY_NETWORK] =
				input.composeType === "docker-compose" ? { aliases: [alias] } : {};
			service.networks = existing;
		}
	}
	return next;
}

/** Full transform applied right before deploy: suffix + network injection. */
export function buildDeployComposeFile(
	content: string,
	input: { appName: string; composeType: "docker-compose" | "stack"; suffix?: string | null },
): string {
	let spec = parseComposeFile(content);
	if (input.suffix) {
		spec = randomizeServiceNames(spec, input.suffix);
	}
	spec = injectNetwork(spec, { appName: input.appName, composeType: input.composeType });
	return stringify(spec);
}

/**
 * Merge `KEY=VALUE` env files, later sources overriding earlier ones
 * (project → environment → service). Comments and blank lines are dropped.
 */
export function mergeEnvVars(...sources: Array<string | null | undefined>): string {
	const byKey = new Map<string, string>();
	for (const source of sources) {
		if (!source) continue;
		for (const line of source.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			byKey.set(trimmed.slice(0, eq).trim(), trimmed);
		}
	}
	return [...byKey.values()].join("\n");
}
