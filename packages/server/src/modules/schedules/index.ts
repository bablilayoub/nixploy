import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { deployments, schedules } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { getConfigDir } from "../application/paths";
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

/** Live node-schedule jobs, keyed by scheduleId. */
const jobs = new Map<string, schedule.Job>();
/** Last-run state, keyed by scheduleId (runtime-only, rebuilt on boot). */
const runStates = new Map<string, ScheduleRunState>();
/** scheduleIds with a run in flight — cron ticks must never overlap runs. */
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

/** Syntax-check a cron expression without registering a real job. */
export function isValidCron(cronExpression: string): boolean {
	const probe = schedule.scheduleJob(cronExpression, () => {});
	if (!probe) return false;
	probe.cancel();
	return true;
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

/** Execute a schedule immediately (used by cron jobs and manual runs). */
export async function runSchedule(
	row: ScheduleRow,
	trigger: "cron" | "manual" = "cron",
): Promise<ScheduleRunResult> {
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
	}
}

/** (Re)register the cron job for a schedule row. No-op when disabled. */
export function registerSchedule(row: ScheduleRow): void {
	unregisterSchedule(row.scheduleId);
	if (!row.enabled) return;
	const job = schedule.scheduleJob(row.scheduleId, row.cronExpression, () => {
		// Skip this tick when the previous run is still going (mirrors the
		// guards in reconciler.ts / maintenance.ts).
		if (inFlight.has(row.scheduleId)) {
			log.warn(`Schedule ${row.name} (${row.scheduleId}) still running — skipping tick`);
			return;
		}
		inFlight.add(row.scheduleId);
		void runSchedule(row, "cron")
			.catch((error) => {
				log.error(`Schedule ${row.name} (${row.scheduleId}) failed`, {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				inFlight.delete(row.scheduleId);
			});
	});
	if (!job) {
		throw new Error(`Invalid cron expression: ${row.cronExpression}`);
	}
	jobs.set(row.scheduleId, job);
}

/** Cancel and drop the cron job for a schedule. */
export function unregisterSchedule(scheduleId: string): void {
	jobs.get(scheduleId)?.cancel();
	jobs.delete(scheduleId);
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
