import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { applications, compose, deployments, schedules } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { getConfigDir } from "../application/paths";
import { isValidCronExpression } from "./cron";
import { runScheduleCommand } from "./runner";

const log = createLogger("schedules");

export type { ScheduleTarget } from "./runner";
export { runScheduleCommand } from "./runner";

export type ScheduleRow = typeof schedules.$inferSelect;

/** Runtime execution state, exposed through the schedule router. */
export interface ScheduleRunState {
	lastRunAt: Date | null;
	lastStatus: "running" | "success" | "error" | null;
	lastError: string | null;
}

const SCHEDULES_LOG_DIR =
	process.env.NIXPLOY_SCHEDULES_LOG_PATH ?? path.join(getConfigDir(), "schedules");

/** Live node-schedule jobs (plus the row they were registered from), keyed by scheduleId. */
const jobs = new Map<string, { job: schedule.Job; row: ScheduleRow }>();
/** Last-run state, keyed by scheduleId (runtime-only, rebuilt on boot). */
const runStates = new Map<string, ScheduleRunState>();
/** scheduleIds with a run in flight — cron ticks skip, manual runs refuse to overlap. */
const inFlight = new Set<string>();

function getState(scheduleId: string): ScheduleRunState {
	let state = runStates.get(scheduleId);
	if (!state) {
		state = { lastRunAt: null, lastStatus: null, lastError: null };
		runStates.set(scheduleId, state);
	}
	return state;
}

export function getScheduleRunState(scheduleId: string): ScheduleRunState {
	return getState(scheduleId);
}

/**
 * Syntax-check a cron expression without registering a real job. Strict:
 * node-schedule would otherwise accept any date string as a one-shot job.
 */
export function isValidCron(cronExpression: string): boolean {
	return isValidCronExpression(cronExpression);
}

export function isScheduleRunning(scheduleId: string): boolean {
	return inFlight.has(scheduleId);
}

/** Persist a run's output and mirror it into a deployment row for history. */
async function recordRun(
	row: ScheduleRow,
	result: {
		trigger: "cron" | "manual";
		status: "done" | "error";
		output: string;
		errorMessage?: string | null;
		startedAt: Date;
		finishedAt: Date;
	},
): Promise<void> {
	await mkdir(SCHEDULES_LOG_DIR, { recursive: true });
	const logPath = path.join(
		SCHEDULES_LOG_DIR,
		`${row.scheduleId}-${result.finishedAt.getTime()}.log`,
	);
	const header = [
		`Schedule: ${row.name} (${row.scheduleId})`,
		`Trigger: ${result.trigger}`,
		`Started: ${result.startedAt.toISOString()}`,
		`Finished: ${result.finishedAt.toISOString()}`,
		`Status: ${result.status}`,
		"",
	].join("\n");
	await writeFile(logPath, header + result.output, "utf8");

	try {
		await db.insert(deployments).values({
			title: `Schedule: ${row.name}`,
			description: result.trigger === "manual" ? "Manual schedule run" : "Scheduled run",
			status: result.status,
			logPath,
			errorMessage: result.errorMessage ?? null,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			applicationId: row.applicationId,
			composeId: row.composeId,
			serverId: row.serverId,
			scheduleId: row.scheduleId,
		});
	} catch (error) {
		log.error(`Failed to record schedule run ${row.scheduleId}`, {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export interface ScheduleRunResult {
	success: boolean;
	output: string;
	startedAt: Date;
	finishedAt: Date;
}

/**
 * Execute a schedule immediately (used by cron jobs and manual runs). Holds
 * the per-schedule in-flight guard: a manual run while a run is in progress
 * throws instead of doubling up.
 */
export async function runSchedule(
	row: ScheduleRow,
	trigger: "cron" | "manual" = "cron",
): Promise<ScheduleRunResult> {
	if (inFlight.has(row.scheduleId)) {
		throw new Error(`Schedule "${row.name}" is already running — wait for it to finish`);
	}
	inFlight.add(row.scheduleId);
	const state = getState(row.scheduleId);
	const startedAt = new Date();
	state.lastRunAt = startedAt;
	state.lastStatus = "running";
	state.lastError = null;

	try {
		const output = await runScheduleCommand(row);
		const finishedAt = new Date();
		state.lastStatus = "success";
		await recordRun(row, {
			trigger,
			status: "done",
			output,
			startedAt,
			finishedAt,
		});
		return { success: true, output, startedAt, finishedAt };
	} catch (error) {
		const finishedAt = new Date();
		const message = error instanceof Error ? error.message : String(error);
		const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
		state.lastStatus = "error";
		state.lastError = message;
		await recordRun(row, {
			trigger,
			status: "error",
			output: [message, stderr].filter(Boolean).join("\n\n"),
			errorMessage: message,
			startedAt,
			finishedAt,
		});
		if (trigger === "manual") {
			throw error;
		}
		return { success: false, output: message, startedAt, finishedAt };
	} finally {
		inFlight.delete(row.scheduleId);
	}
}

/**
 * Cron tick: re-read the row so a schedule deleted/disabled (or whose target
 * service was deleted — rows cascade) stops firing instead of `docker exec`-ing
 * into whatever now carries the label.
 */
async function tickSchedule(scheduleId: string): Promise<void> {
	if (inFlight.has(scheduleId)) {
		// Skip this tick when the previous run is still going (mirrors the
		// guards in reconciler.ts / maintenance.ts).
		log.warn(`Schedule ${scheduleId} still running — skipping tick`);
		return;
	}
	const row = await db.query.schedules.findFirst({
		where: eq(schedules.scheduleId, scheduleId),
	});
	if (!row?.enabled) {
		log.info(`Schedule ${scheduleId} was removed or disabled — unregistering its cron job`);
		unregisterSchedule(scheduleId);
		return;
	}
	const target = await scheduleTargetExists(row);
	if (!target) {
		log.warn(`Schedule ${row.name} (${scheduleId}) lost its target service — unregistering`);
		unregisterSchedule(scheduleId);
		return;
	}
	await runSchedule(row, "cron").catch((error) => {
		log.error(`Schedule ${row.name} (${scheduleId}) failed`, {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

/** Application/compose schedules need their service row; other types always resolve. */
async function scheduleTargetExists(row: ScheduleRow): Promise<boolean> {
	if (row.scheduleType === "application") {
		if (!row.applicationId) return true;
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, row.applicationId),
			columns: { applicationId: true },
		});
		return Boolean(app);
	}
	if (row.scheduleType === "compose") {
		if (!row.composeId) return true;
		const stack = await db.query.compose.findFirst({
			where: eq(compose.composeId, row.composeId),
			columns: { composeId: true },
		});
		return Boolean(stack);
	}
	return true;
}

/** (Re)register the cron job for a schedule row. No-op when disabled. */
export function registerSchedule(row: ScheduleRow): void {
	unregisterSchedule(row.scheduleId);
	if (!row.enabled) return;
	if (!isValidCron(row.cronExpression)) {
		throw new Error(`Invalid cron expression: ${row.cronExpression}`);
	}
	const job = schedule.scheduleJob(row.scheduleId, row.cronExpression, () => {
		void tickSchedule(row.scheduleId).catch((error) => {
			log.error(`Schedule tick ${row.scheduleId} crashed`, {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	});
	if (!job) {
		throw new Error(`Invalid cron expression: ${row.cronExpression}`);
	}
	jobs.set(row.scheduleId, { job, row });
}

/** Cancel and drop the cron job for a schedule. */
export function unregisterSchedule(scheduleId: string): void {
	jobs.get(scheduleId)?.job.cancel();
	jobs.delete(scheduleId);
}

/**
 * Cancel every cron job targeting a service that is being deleted (matched
 * on applicationId / composeId, falling back to appName). Call it from the
 * application/compose delete paths so a deleted service's schedules stop
 * immediately. Returns the number of jobs cancelled.
 */
export function unregisterSchedulesForService(service: {
	appName?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
}): number {
	let cancelled = 0;
	for (const [scheduleId, entry] of jobs) {
		const { row } = entry;
		const matches =
			(service.applicationId && row.applicationId === service.applicationId) ||
			(service.composeId && row.composeId === service.composeId) ||
			(service.appName && row.appName === service.appName);
		if (matches) {
			unregisterSchedule(scheduleId);
			cancelled += 1;
		}
	}
	return cancelled;
}

export function isScheduleRegistered(scheduleId: string): boolean {
	return jobs.has(scheduleId);
}

/** Register every enabled schedule at process boot. */
export async function initSchedules(): Promise<void> {
	const rows = await db.query.schedules.findMany({
		where: eq(schedules.enabled, true),
	});
	for (const row of rows) {
		try {
			registerSchedule(row);
		} catch (error) {
			log.error(`Failed to register schedule ${row.name} (${row.scheduleId})`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log.info(`Initialized ${jobs.size} schedules`);
}
