/**
 * Runtime profile: the defaults a small box gets.
 *
 * `NIXPLOY_LITE=1` does not turn features off behind the operator's back —
 * it changes the **defaults** of a handful of knobs that cost memory and
 * disk, each of which an operator could set individually. An explicit
 * environment variable always wins, so a lite install that wants runtime
 * logs back sets `NIXPLOY_RUNTIME_LOGS=1` and keeps everything else lean.
 *
 * Import-free on purpose (`process.env` only): read from the harvester, the
 * metrics store and sampler, the uptime cron and the SSH pool, all of which
 * load long before anything else.
 */

export interface ProfileDefaults {
	/** Harvest what containers print (the 30 s pass + its disk usage). */
	runtimeLogs: boolean;
	/** Cron of the metrics-history sampler. */
	metricsSampleCron: string;
	/** Hours of metrics history kept per service. */
	metricsRetentionHours: number;
	/** Days of runtime log history kept per service. */
	runtimeLogRetentionDays: number;
	/** Megabytes of runtime log history kept per service. */
	runtimeLogMaxMbPerService: number;
	/** Cron of the uptime probe pass. */
	uptimeProbeCron: string;
	/** SSH channels held open per managed server. */
	sshMaxChannels: number;
}

/** What every install gets unless it asks for the lite profile. */
export const NORMAL_PROFILE: ProfileDefaults = {
	runtimeLogs: true,
	metricsSampleCron: "*/30 * * * * *",
	metricsRetentionHours: 48,
	runtimeLogRetentionDays: 7,
	runtimeLogMaxMbPerService: 256,
	uptimeProbeCron: "*/30 * * * * *",
	sshMaxChannels: 8,
};

/**
 * The 1–2 GB box profile. What it gives up, in order of how much it saves:
 * the runtime log history (the harvester's per-pass buffers and its disk),
 * metric resolution (two minutes instead of thirty seconds, half a day of
 * history instead of two), a slower uptime pass and fewer SSH channels.
 * Nothing about deploys, routing, backups or the queue changes.
 */
export const LITE_PROFILE: ProfileDefaults = {
	runtimeLogs: false,
	metricsSampleCron: "0 */2 * * * *",
	metricsRetentionHours: 12,
	runtimeLogRetentionDays: 2,
	runtimeLogMaxMbPerService: 64,
	uptimeProbeCron: "0 */2 * * * *",
	sshMaxChannels: 4,
};

/** Is the lite profile on? `NIXPLOY_LITE=1` / `true`, nothing else. */
export function liteProfileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.NIXPLOY_LITE?.trim().toLowerCase();
	return raw === "1" || raw === "true";
}

/** Defaults for this process — read per call so tests can flip the variable. */
export function profileDefaults(env: NodeJS.ProcessEnv = process.env): ProfileDefaults {
	return liteProfileEnabled(env) ? LITE_PROFILE : NORMAL_PROFILE;
}
