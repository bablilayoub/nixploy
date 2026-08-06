import { execAsync, execAsyncRemote } from "../../utils/exec";

/**
 * Prune Docker build debris on a server: dangling/unused images and the
 * BuildKit daemon cache (nixpacks/buildpack builds accumulate GBs of it).
 * Local Nixploy BuildKit export dirs under `$NIXPLOY_CONFIG_DIR/cache/buildkit`
 * are left intact so app-scoped cache-from/cache-to survives cleanup.
 * Running containers, volumes and tagged-in-use images are left untouched.
 * `serverId` null/undefined → the Nixploy host itself.
 */
export async function dockerCleanup(serverId?: string | null): Promise<void> {
	const command = "docker image prune -af && docker builder prune -af";
	if (serverId) {
		await execAsyncRemote(serverId, command);
		return;
	}
	await execAsync(command);
}
