import schedule from "node-schedule";
import { createLogger } from "../../lib/logger";
import { bestEffort } from "../../utils/best-effort";
import { applyUpdate, clearStaleUpdateFlag } from "./apply";
import { checkForUpdates } from "./check";
import { DEFAULT_CHECK_CRON, getUpdateSettings, patchUpdateSettings } from "./settings";

const log = createLogger("updates");

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
			log.warn(`Update check failed: ${result.error}`);
			return;
		}
		if (result.updateAvailable) {
			log.info(
				`Update available: ${result.currentDigest?.slice(0, 19)}… → ${result.latestDigest?.slice(0, 19)}…`,
			);
		}
		if (result.updateAvailable && settings.autoUpdateEnabled) {
			log.info(`Auto-update: rolling ${result.latestImage}`);
			await applyUpdate({ image: result.latestImage });
		}
	} catch (error) {
		log.error("Update check pass failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		inFlight = false;
	}
}

/**
 * Whether node-schedule accepts `cron` as a recurring 5/6-field expression.
 * node-schedule silently falls back to `new Date(spec)` for non-cron strings
 * (a one-shot job) and returns `null` for garbage — both are rejected here so
 * a typo cannot silently stop the checker.
 */
export function isValidUpdateCron(cron: string): boolean {
	const trimmed = cron.trim();
	const fields = trimmed.split(/\s+/).length;
	if (fields !== 5 && fields !== 6) return false;
	const probe = schedule.scheduleJob(trimmed, () => {});
	if (!probe) return false;
	probe.cancel();
	return true;
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
		log.info("Update checker disabled");
		return;
	}
	job = isValidUpdateCron(cron)
		? schedule.scheduleJob("nixploy-update-check", cron, () => {
				void runUpdatePass();
			})
		: null;
	if (!job) {
		const message = `Invalid update check cron "${cron}" — automatic checks are paused until it is fixed`;
		log.error(message);
		await bestEffort("record invalid update cron", () =>
			patchUpdateSettings({ lastError: message }),
		);
		return;
	}
	log.info(`Update checker scheduled (${cron})`);
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
