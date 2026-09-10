import { execAsync } from "../../utils/exec";
import { shellQuote } from "../deployment/paths";
import { NIXPLOY_SERVICE_NAME } from "./check";
import { assertValidImageRef } from "./registry";
import { getUpdateSettings, patchUpdateSettings } from "./settings";

let applyInFlight = false;

/** Consider an update stuck after this long and clear the flag. */
const UPDATE_STUCK_AFTER_MS = 15 * 60 * 1000;

export interface ApplyUpdateResult {
	started: boolean;
	image: string;
	message: string;
}

/**
 * Pull the tracked image, then roll the `nixploy` Swarm service.
 *
 * The service publishes port 3000 in host mode, so the roll MUST be
 * `stop-first`: with start-first the new task can never bind the port while
 * the old one holds it and the update deadlocks (spinner forever).
 *
 * The pull happens synchronously so failures surface to the caller; the
 * actual `docker service update` is delayed a couple of seconds so the HTTP
 * response reaches the browser before this very process is stopped.
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

	// Validate before anything touches a shell: the ref is stored settings /
	// caller input, and `exec` runs through `sh -c`.
	const image = assertValidImageRef(options?.image?.trim() || settings.image).canonical;
	applyInFlight = true;

	try {
		await execAsync(`docker pull ${shellQuote(image)}`, { timeout: 600_000 });
	} catch (error) {
		applyInFlight = false;
		const message = error instanceof Error ? error.message : String(error);
		await patchUpdateSettings({ lastError: `Image pull failed: ${message}` });
		throw error;
	}

	// `lastUpdateAt` doubles as "when this attempt started" for stuck detection.
	await patchUpdateSettings({
		updateInProgress: true,
		updateAvailable: false,
		lastUpdateAt: new Date().toISOString(),
		lastError: null,
	});

	// Roll after the response has been flushed to the client. stop-first stops
	// this container almost immediately, so nothing may run after this point.
	setTimeout(() => {
		void (async () => {
			try {
				// A task that fails to start (bad migration, boot crash) rolls the
				// service back to the previous spec instead of crash-looping with
				// the panel down. Rollback must be stop-first for the same
				// host-mode port reason as the update itself.
				await execAsync(
					[
						"docker service update",
						"--detach",
						"--force",
						"--no-resolve-image",
						`--image ${shellQuote(image)}`,
						"--update-order stop-first",
						"--update-failure-action rollback",
						"--rollback-order stop-first",
						NIXPLOY_SERVICE_NAME,
					].join(" "),
					{ timeout: 120_000 },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error("Self-update roll failed:", message);
				await patchUpdateSettings({
					updateInProgress: false,
					lastError: `Service update failed: ${message}`,
				}).catch(() => {});
			} finally {
				applyInFlight = false;
			}
		})();
	}, 2_000);

	return {
		started: true,
		image,
		message: "Update started — the dashboard restarts in a few seconds",
	};
}

/** Clear the in-progress flag after the new container has booted. */
export async function clearStaleUpdateFlag(): Promise<void> {
	const settings = await getUpdateSettings();
	if (!settings.updateInProgress) return;
	await patchUpdateSettings({ updateInProgress: false });
}

/**
 * Safety net for rolls that never converged (e.g. the old start-first
 * deadlock, or docker failing after the flag was set): if the flag has been
 * up longer than {@link UPDATE_STUCK_AFTER_MS}, clear it and surface an
 * error so the UI un-sticks.
 */
export async function resolveStuckUpdate(): Promise<void> {
	const settings = await getUpdateSettings();
	if (!settings.updateInProgress) return;
	const startedAt = settings.lastUpdateAt ? Date.parse(settings.lastUpdateAt) : Number.NaN;
	if (Number.isFinite(startedAt) && Date.now() - startedAt < UPDATE_STUCK_AFTER_MS) return;
	await patchUpdateSettings({
		updateInProgress: false,
		lastError:
			"The previous update did not complete — check `docker service ps nixploy` on the server",
	});
}
