import { execAsync } from "../../utils/exec";
import { NIXPLOY_SERVICE_NAME } from "./check";
import { getUpdateSettings, patchUpdateSettings } from "./settings";

let applyInFlight = false;

export interface ApplyUpdateResult {
	started: boolean;
	image: string;
	message: string;
}

/**
 * Pull the tracked image and force-roll the `nixploy` Swarm service.
 *
 * Returns as soon as the update is *scheduled* — with `--detach` and
 * start-first ordering the current process will be replaced shortly after,
 * so callers must not wait for health here.
 */
export async function applyUpdate(options?: {
	/** Override the image from settings (rarely needed). */
	image?: string;
}): Promise<ApplyUpdateResult> {
	if (applyInFlight) {
		return {
			started: false,
			image: options?.image ?? (await getUpdateSettings()).image,
			message: "An update is already in progress",
		};
	}

	const settings = await getUpdateSettings();
	if (settings.updateInProgress) {
		return {
			started: false,
			image: settings.image,
			message: "An update is already in progress",
		};
	}

	const image = options?.image?.trim() || settings.image;
	applyInFlight = true;
	await patchUpdateSettings({
		updateInProgress: true,
		lastError: null,
	});

	try {
		await execAsync(`docker pull ${JSON.stringify(image)}`, { timeout: 600_000 });
		await execAsync(
			[
				"docker service update",
				"--detach",
				"--force",
				"--no-resolve-image",
				`--image ${JSON.stringify(image)}`,
				"--update-order start-first",
				NIXPLOY_SERVICE_NAME,
			].join(" "),
			{ timeout: 120_000 },
		);

		await patchUpdateSettings({
			lastUpdateAt: new Date().toISOString(),
			updateAvailable: false,
			lastError: null,
			// Cleared on the next successful boot check; leave the flag until then
			// so the UI can show "updating…" across the restart.
			updateInProgress: true,
		});

		return {
			started: true,
			image,
			message: "Update started — the dashboard will come back in a moment",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await patchUpdateSettings({
			updateInProgress: false,
			lastError: message,
		});
		throw error;
	} finally {
		applyInFlight = false;
	}
}

/** Clear a stuck in-progress flag after the new container has booted. */
export async function clearStaleUpdateFlag(): Promise<void> {
	const settings = await getUpdateSettings();
	if (!settings.updateInProgress) return;
	await patchUpdateSettings({ updateInProgress: false });
}
