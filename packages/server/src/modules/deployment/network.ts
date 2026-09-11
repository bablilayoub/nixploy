import { eq } from "drizzle-orm";
import { db } from "../../db";
import { environments } from "../../db/schema";
import { getDocker } from "./docker";

/**
 * Tenant network segmentation.
 *
 * Three overlay tiers exist on the swarm:
 *
 * 1. `nixploy-internal` — panel ↔ Postgres. No tenant workload ever joins it
 *    (created by `install.sh` / `update.sh`, not by this module).
 * 2. `nixploy-network` — the shared, Traefik-facing overlay. Only services
 *    that are actually routed (an application with at least one domain, a
 *    compose service that is a Traefik target, a PR preview) join it, with
 *    their service name / alias as the backend Traefik dials.
 * 3. `<env-slug>-<env-id8>-net` — a private attachable overlay per
 *    **environment**. Every application, database and compose service of that
 *    environment joins it, so a tenant's own services still resolve each
 *    other by name (`api` → `db-abc123`) while another organisation's
 *    containers cannot see them at all.
 *
 * Compose stacks additionally keep their `<appName>-net` (see
 * `compose/compose-file.ts`) so bare service names (`db`, `redis`) stay
 * scoped to the stack.
 */

/**
 * Network-name prefix owned by the platform. `sanitizeNetworkAttachments`
 * only lets hand-written `networkSwarm` overrides target this prefix, and
 * tenant-derived names (app names, environment networks) must never fall
 * inside it — otherwise a tenant could name a service into the platform
 * namespace and have another tenant "legitimately" attach to it.
 */
export const PLATFORM_NETWORK_PREFIX = "nixploy-";

/** Panel ↔ Postgres overlay. Tenant workloads never join it. */
export const INTERNAL_NETWORK_NAME = "nixploy-internal";

/** Suffix shared with the per-app compose network, for recognisability. */
const PRIVATE_NETWORK_SUFFIX = "-net";

/** Environment row fields the network name is derived from. */
export interface EnvironmentNetworkSource {
	environmentId: string;
	name: string;
}

/**
 * Deterministic name of an environment's private overlay:
 * `<slug of environment.name>-<first 8 chars of the id>-net`.
 *
 * The id keeps it unique across projects/orgs that both call an environment
 * "production"; the slug keeps `docker network ls` readable. Names that would
 * land in the platform namespace are prefixed with `env-`.
 */
export function environmentNetworkName(environment: EnvironmentNetworkSource): string {
	const slug =
		environment.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 24)
			.replace(/-+$/, "") || "env";
	const safe = slug.startsWith("nixploy") ? `env-${slug}` : slug;
	const short = environment.environmentId
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 8)
		.toLowerCase();
	return `${safe}-${short || "00000000"}${PRIVATE_NETWORK_SUFFIX}`;
}

/** Whether a network name belongs to the platform (`nixploy-*`). */
export const isPlatformNetwork = (name: string): boolean =>
	name.startsWith(PLATFORM_NETWORK_PREFIX);

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { statusCode?: number }).statusCode === 404;

/**
 * Create an attachable overlay network if it does not exist yet. Swarm
 * networks are cluster-scoped objects, so this always runs against the
 * primary manager — managed servers see the network once a task lands there.
 */
export async function ensureOverlayNetwork(name: string): Promise<string> {
	const docker = await getDocker();
	try {
		await docker.getNetwork(name).inspect();
		return name;
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
	try {
		await docker.createNetwork({ Name: name, Driver: "overlay", Attachable: true });
	} catch (error) {
		// Two deploys of the same environment can race here; a 409 means the
		// other one won, which is exactly the state we wanted.
		if ((error as { statusCode?: number }).statusCode !== 409) throw error;
	}
	return name;
}

/** Environment row → network name, creating the overlay when missing. */
export async function ensureEnvironmentNetwork(
	environment: EnvironmentNetworkSource,
): Promise<string> {
	return ensureOverlayNetwork(environmentNetworkName(environment));
}

/**
 * Load an environment and return its network name, or `null` when the row is
 * already gone (project cascade deletes the environment before the teardown
 * of its services finishes).
 */
export async function loadEnvironmentNetworkName(environmentId: string): Promise<string | null> {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		columns: { environmentId: true, name: true },
	});
	return environment ? environmentNetworkName(environment) : null;
}

/** Look the environment up and create its overlay. Used by every deploy path. */
export async function ensureEnvironmentNetworkById(environmentId: string): Promise<string | null> {
	const name = await loadEnvironmentNetworkName(environmentId);
	if (!name) return null;
	return ensureOverlayNetwork(name);
}

const PRUNE_ATTEMPTS = 4;
const PRUNE_RETRY_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Remove an environment's overlay once the last service left it.
 *
 * `docker network rm` refuses a network that still has endpoints, which is
 * exactly the "only when empty" semantic we want — so failures are swallowed.
 * `service rm` returns before its tasks detach, hence the short retry loop;
 * a network that is genuinely still in use simply survives.
 */
export async function removeEnvironmentNetwork(name: string): Promise<void> {
	const docker = await getDocker();
	for (let attempt = 1; attempt <= PRUNE_ATTEMPTS; attempt++) {
		try {
			await docker.getNetwork(name).remove();
			return;
		} catch (error) {
			if (isNotFound(error)) return;
			if (attempt === PRUNE_ATTEMPTS) return;
			await sleep(PRUNE_RETRY_MS);
		}
	}
}

/**
 * Best-effort teardown hook: called after the last service of an environment
 * is removed (application/compose/database delete). Never throws.
 */
export async function pruneEnvironmentNetwork(
	environmentId: string | null | undefined,
): Promise<void> {
	if (!environmentId) return;
	try {
		const name = await loadEnvironmentNetworkName(environmentId);
		if (!name) return;
		await removeEnvironmentNetwork(name);
	} catch {
		// teardown is best effort — a leftover empty overlay is harmless
	}
}
