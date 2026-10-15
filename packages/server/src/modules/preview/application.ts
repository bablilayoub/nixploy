import fs from "node:fs/promises";
import { bestEffort } from "../../utils/best-effort";
import { execAsyncRemote } from "../../utils/exec";
import { getAppBasePath, getBuildCachePath, shellQuote } from "../deployment/paths";

/** Only the preview's checkout and build cache; deployment logs retain their normal history. */
export async function removePreviewApplicationFiles(
	appName: string,
	serverId: string | null,
): Promise<void> {
	const paths = [getAppBasePath(appName), getBuildCachePath(appName)];
	await bestEffort(`remove files for preview ${appName}`, async () => {
		if (serverId) {
			await execAsyncRemote(serverId, `rm -rf -- ${paths.map(shellQuote).join(" ")}`);
			return;
		}
		await Promise.all(paths.map((path) => fs.rm(path, { recursive: true, force: true })));
	});
}
