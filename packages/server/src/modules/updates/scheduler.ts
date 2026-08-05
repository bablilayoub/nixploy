import schedule from "node-schedule";
import { applyUpdate, clearStaleUpdateFlag } from "./apply";
import { checkForUpdates } from "./check";
import { DEFAULT_CHECK_CRON, getUpdateSettings } from "./settings";

let started = false;
let inFlight = false;
let job: schedule.Job | null = null;

async function runUpdatePass(): Promise<void> {
	if (inFlight) return;
	inFlight = true;
	try {
		const settings = await getUpdateSettings();
		if (!settings.autoCheckEnabled) return;

		const result = await checkForUpdates({ persist: true });
		if (result.error) {
			console.warn(`▲ Update check failed: ${result.error}`);
			return;
		}
		if (result.updateAvailable) {
			console.log(
				`▲ Update available: ${result.currentDigest?.slice(0, 19)}… → ${result.latestDigest?.slice(0, 19)}…`,
			);
		}
		if (result.updateAvailable && settings.autoUpdateEnabled) {
			console.log(`▲ Auto-update: rolling ${result.latestImage}`);
			await applyUpdate({ image: result.latestImage });
		}
	} catch (error) {
		console.error("Update check pass failed:", error);
	} finally {
		inFlight = false;
	}
}

/** Re-read settings and (re)register the cron job when the schedule changes. */
export async function rescheduleUpdateChecker(): Promise<void> {
	const settings = await getUpdateSettings();
	const cron = settings.checkCron || DEFAULT_CHECK_CRON;
	if (job) {
		job.cancel();
		job = null;
	}
	if (!settings.autoCheckEnabled) {
		console.log("▲ Update checker disabled");
		return;
	}
	job = schedule.scheduleJob("nixploy-update-check", cron, () => {
		void runUpdatePass();
	});
	console.log(`▲ Update checker scheduled (${cron})`);
}

/**
 * Register the periodic update checker (idempotent). Clears a stuck
 * "updating" flag left by a previous roll, then schedules the cron.
 */
export async function initUpdateChecker(): Promise<void> {
	if (started) return;
	started = true;
	try {
		await clearStaleUpdateFlag();
	} catch {
		// Settings table may not exist yet on first boot.
	}
	await rescheduleUpdateChecker();
	// Fire once shortly after boot so the UI isn't empty until the first cron.
	setTimeout(() => {
		void runUpdatePass();
	}, 30_000);
}
