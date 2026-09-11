import { stringify } from "yaml";
import { getSwarmNetwork } from "../application/paths";
import { mergeNodeConstraint } from "../cluster/placement";
import { escapeComposeInterpolation, renderComposeSpec } from "./interpolate";
import {
	type ComposeEnv,
	type ComposeFileSpec,
	type ComposeServiceSpec,
	parseComposeFile,
} from "./parse";
import { applyComposeHardening, assertSafeComposeSpec, type ComposeSafetyOptions } from "./safety";

/**
 * Deploy-time rewriting of a compose spec: service renaming, the private /
 * environment / shared network wiring, swarm normalization and node pinning,
 * plus `buildDeployComposeFile` which runs the whole pipeline.
 */

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

/** Name of the private per-app network every service of `appName` joins. */
export const privateNetworkName = (appName: string) => `${appName}-net`;

function toNetworkMap(
	networks: ComposeServiceSpec["networks"],
): Record<string, { aliases?: string[] } & Record<string, unknown>> {
	const map: Record<string, { aliases?: string[] } & Record<string, unknown>> = {};
	if (Array.isArray(networks)) {
		for (const name of networks) map[String(name)] = {};
		return map;
	}
	if (networks && typeof networks === "object") {
		for (const [name, config] of Object.entries(networks)) {
			map[name] = config && typeof config === "object" ? { ...config } : {};
		}
	}
	return map;
}

/**
 * Networking for a deploy:
 * - every service joins a private per-app network (`<appName>-net`) so bare
 *   service names (`db`, `redis`) only resolve inside this stack — on the
 *   shared overlay they would round-robin across tenants;
 * - every service also joins the **environment** overlay
 *   (`environmentNetwork`, see `deployment/network.ts`) under the qualified
 *   alias `<appName>-<serviceName>`, so the tenant's own applications and
 *   databases in that environment can reach the stack without anybody else
 *   seeing it;
 * - only `exposedServices` (the Traefik targets) also join `nixploy-network`,
 *   with the alias `<appName>-<serviceName>` Traefik routes to. Any tenant
 *   reference to the shared network is dropped first.
 */
export function injectNetwork(
	spec: ComposeFileSpec,
	input: {
		appName: string;
		composeType: "docker-compose" | "stack";
		exposedServices?: Iterable<string>;
		/** Private per-environment overlay; omitted only by legacy callers. */
		environmentNetwork?: string | null;
	},
): ComposeFileSpec {
	const shared = getSwarmNetwork();
	const privateNet = privateNetworkName(input.appName);
	const environmentNet = input.environmentNetwork || null;
	const exposed = new Set(input.exposedServices ?? []);

	const networks: Record<string, unknown> =
		spec.networks && typeof spec.networks === "object" && !Array.isArray(spec.networks)
			? { ...spec.networks }
			: {};
	networks[privateNet] =
		input.composeType === "stack"
			? { name: privateNet, driver: "overlay", attachable: true }
			: { name: privateNet };
	if (environmentNet) {
		// Created by the deploy path before the compose command runs.
		networks[environmentNet] = { external: true, name: environmentNet };
	}
	if (exposed.size > 0) {
		networks[shared] = { external: true, name: shared };
	} else {
		delete networks[shared];
	}

	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const attached = toNetworkMap(service.networks);
		delete attached[shared];
		if (environmentNet) delete attached[environmentNet];
		attached[privateNet] = {};
		if (environmentNet) {
			attached[environmentNet] = { aliases: [`${input.appName}-${serviceName}`] };
		}
		if (exposed.has(serviceName)) {
			attached[shared] = { aliases: [`${input.appName}-${serviceName}`] };
		}
		services[serviceName] = { ...service, networks: attached };
	}
	return { ...spec, networks, services };
}

/**
 * `docker stack deploy` uses the v3 stack loader: it rejects top-level `name:`
 * and long-form `depends_on`. Both are meaningless for swarm — drop / flatten.
 */
function normalizeForStack(spec: ComposeFileSpec): ComposeFileSpec {
	const { name: _name, ...rest } = spec;
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(rest.services ?? {})) {
		const next = { ...service };
		if (next.depends_on && !Array.isArray(next.depends_on) && typeof next.depends_on === "object") {
			next.depends_on = Object.keys(next.depends_on);
		}
		services[serviceName] = next;
	}
	return { ...rest, services };
}

/**
 * Stack mode, row pinned to a managed server: `docker stack deploy` runs on
 * the PRIMARY manager (see compose/source.ts), so every service gets
 * `deploy.placement.constraints: ["node.id==<swarmNodeId>"]` to land its
 * tasks — and their `<appName>_*` named volumes — on the pinned server. The
 * user's other constraints are kept; a foreign `node.id==` pin is replaced.
 *
 * Limitation: `docker stack deploy` never builds (it ignores `build:`, which
 * the safety check rejects anyway), so stack services on a remote must use
 * images the pinned node can pull from a registry.
 */
export function injectNodeConstraint(
	spec: ComposeFileSpec,
	swarmNodeId: string | null | undefined,
): ComposeFileSpec {
	if (!swarmNodeId) return spec;
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const deploy =
			service.deploy && typeof service.deploy === "object" && !Array.isArray(service.deploy)
				? (service.deploy as Record<string, unknown>)
				: {};
		const placement =
			deploy.placement && typeof deploy.placement === "object" && !Array.isArray(deploy.placement)
				? (deploy.placement as Record<string, unknown>)
				: {};
		const constraints = Array.isArray(placement.constraints) ? placement.constraints : [];
		services[serviceName] = {
			...service,
			deploy: {
				...deploy,
				placement: {
					...placement,
					constraints: mergeNodeConstraint(constraints, swarmNodeId),
				},
			},
		};
	}
	return { ...spec, services };
}

export interface DeployComposeInput {
	appName: string;
	composeType: "docker-compose" | "stack";
	/** Isolation suffix applied to every service name (empty/null = none). */
	suffix?: string | null;
	/** Merged project → environment → service env, rendered into the file. */
	env?: ComposeEnv;
	/** Source service names (before the suffix) that have a Nixploy domain. */
	exposedServices?: Iterable<string>;
	/**
	 * Private per-environment overlay every service joins on top of
	 * `<appName>-net` (see `deployment/network.ts`). Must already exist.
	 */
	environmentNetwork?: string | null;
	/**
	 * Stack mode only: primary-swarm node id of the server the row is pinned
	 * to (`getServerSwarmNodeId`); every service is placed on it.
	 */
	swarmNodeId?: string | null;
}

/**
 * Full transform applied right before deploy: safety check on the raw spec,
 * env interpolation, safety check on the rendered spec, suffix, networking.
 * The output contains no live templates (`$` is escaped), so Docker never
 * resolves anything from the host environment.
 */
export function buildDeployComposeFile(
	content: string,
	input: DeployComposeInput,
	options?: ComposeSafetyOptions,
): string {
	const raw = parseComposeFile(content);
	assertSafeComposeSpec(raw, options);
	let spec = renderComposeSpec(raw, input.env ?? {});
	assertSafeComposeSpec(spec, options);

	const suffix = input.suffix || "";
	if (suffix) {
		spec = randomizeServiceNames(spec, suffix);
	}
	const exposedServices = [...(input.exposedServices ?? [])].map((name) =>
		suffix ? `${name}-${suffix}` : name,
	);
	spec = applyComposeHardening(spec, input.composeType);
	spec = injectNetwork(spec, {
		appName: input.appName,
		composeType: input.composeType,
		exposedServices,
		environmentNetwork: input.environmentNetwork,
	});
	if (input.composeType === "stack") {
		spec = injectNodeConstraint(normalizeForStack(spec), input.swarmNodeId);
	}
	return stringify(escapeComposeInterpolation(spec));
}
