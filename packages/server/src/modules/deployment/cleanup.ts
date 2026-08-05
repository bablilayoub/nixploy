import { execAsync, execAsyncRemote } from "../../utils/exec";

/**
 * Prune Docker build debris on a server: dangling/unused images and the
 * build cache (nixpacks/buildpack builds accumulate GBs of it). Running
 * containers, volumes and tagged-in-use images are left untouched.
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
