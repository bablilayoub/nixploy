import Docker from "dockerode";
import { createTtlCache, DOCKER_LISTING_TTL_MS } from "../../utils/ttl-cache";

/**
 * Local container lookups shared by the websocket handlers and the modules
 * that need them. Moved out of `ws/docker.ts` so nothing under `modules/`
 * imports the transport layer (audit F5); `ws/docker.ts` re-exports these
 * under their original names.
 */

/**
 * Micro-cache for the read-only docker listings the Docker control center
 * renders (`docker ps`, `docker images`, `docker service ls`, …) — architecture
 * audit #14. TTL + single flight, keyed by `(view, serverId)`: ten open tabs
 * polling one server collapse into one shell-out (one SSH round-trip for a
 * managed server) per window instead of ten.
 *
 * It lives here rather than inside `trpc/routers/docker.ts` so the deploy
 * worker can drop a server's entries the moment it changes what is running
 * there — a router is not importable from `modules/**`. Authorization always
 * runs BEFORE a lookup; the cached payload is server-scoped, never
 * caller-scoped, so it can never cross a tenant boundary.
 */
export const dockerListingCache = createTtlCache<string>({ ttlMs: DOCKER_LISTING_TTL_MS });

/** Cache key for one listing view on one server (`null` = the Nixploy host). */
export const dockerListingKey = (view: string, serverId: string | null | undefined): string =>
	`${view}:${serverId ?? "__local__"}`;

/**
 * Drop every cached listing for one server. Called after any mutation that
 * changes what is running there: the Docker tab's own actions, and — through
 * the deploy worker — a finished deployment, start or stop.
 */
export function invalidateDockerListings(serverId: string | null | undefined): void {
	const suffix = `:${serverId ?? "__local__"}`;
	dockerListingCache.invalidateWhere((key) => key.endsWith(suffix));
}

let dockerInstance: Docker | null = null;

/** Local dockerode client (daemon socket on the Nixploy host). */
export function getLocalDocker(): Docker {
	if (!dockerInstance) {
		dockerInstance = new Docker();
	}
	return dockerInstance;
}

/**
 * Resolve a running container for an app on the local daemon.
 * Prefer exact Swarm / compose labels — never substring `name=` matching.
 */
export async function resolveLocalContainer(appName: string): Promise<Docker.Container | null> {
	const docker = getLocalDocker();
	const labelFilters = [
		[`com.docker.swarm.service.name=${appName}`],
		[`com.docker.compose.project=${appName}`],
		[`com.docker.stack.namespace=${appName}`],
	];
	for (const label of labelFilters) {
		const matches = await docker.listContainers({ filters: { label } });
		const first = matches[0];
		if (first) return docker.getContainer(first.Id);
	}
	return null;
}
