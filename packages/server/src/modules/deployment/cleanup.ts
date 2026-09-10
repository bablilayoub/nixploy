import { execAsync, execAsyncRemote } from "../../utils/exec";

/**
 * Prune Docker build debris on a server: DANGLING images (untagged layers
 * left behind when `appName:latest` is rebuilt) and the BuildKit daemon
 * cache (nixpacks/buildpack builds accumulate GBs of it).
 *
 * Deliberately not `docker image prune -a`: a stopped application is scaled
 * to 0, so its `appName:latest` has no container and "all unused" pruning
 * would delete the only copy of the image (locally built, never pushed) —
 * the next Start then fails with "No such image" until a full rebuild. The
 * same applies to rollback pins (`appName:<version>`) and images pulled for
 * removed compose stacks. Tagged images are only removed by explicit
 * user action (Docker control center) or rollback-history pruning.
 *
 * Local Nixploy BuildKit export dirs under `$NIXPLOY_CONFIG_DIR/cache/buildkit`
 * are left intact so app-scoped cache-from/cache-to survives cleanup.
 * `serverId` null/undefined → the Nixploy host itself.
 */
export async function dockerCleanup(serverId?: string | null): Promise<void> {
	const command = "docker image prune -f && docker builder prune -af";
	if (serverId) {
		await execAsyncRemote(serverId, command);
		return;
	}
	await execAsync(command);
}
