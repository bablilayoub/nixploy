import schedule from "node-schedule";

/** Default for `NIXPLOY_SHUTDOWN_GRACE_MS`: how long SIGTERM waits for running deployments. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 60_000;

/** How long {@link stopScheduledJobs} waits for a cron tick that is mid-flight. */
const CRON_STOP_TIMEOUT_MS = 10_000;

/**
 * Grace period the graceful-shutdown path gives running deployments before
 * cancelling them (`NIXPLOY_SHUTDOWN_GRACE_MS`, default 60 s). Keep it below
 * the Swarm `--stop-grace-period` of the `nixploy` service, or Docker kills
 * the process before the queue finished finalizing rows.
 */
export function shutdownGraceMs(): number {
	const fromEnv = Number.parseInt(process.env.NIXPLOY_SHUTDOWN_GRACE_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_SHUTDOWN_GRACE_MS;
}

/**
 * Cancel every node-schedule cron (backups, service schedules, metrics,
 * uptime probes, reconciler, maintenance, update checker — they all register
 * through the one `node-schedule` instance) and wait, bounded, for ticks that
 * are still running. node-schedule's own `gracefulShutdown` polls forever
 * when a tick never returns, hence the cap. Lives in the server package
 * because `node-schedule` is not a dependency of the web app.
 */
export async function stopScheduledJobs(
	timeoutMs = CRON_STOP_TIMEOUT_MS,
): Promise<{ jobs: number; timedOut: boolean }> {
	const jobs = Object.keys(schedule.scheduledJobs).length;
	let timer: NodeJS.Timeout | null = null;
	const timedOut = await Promise.race([
		schedule.gracefulShutdown().then(() => false),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), timeoutMs);
		}),
	]);
	if (timer) clearTimeout(timer);
	return { jobs, timedOut };
}
