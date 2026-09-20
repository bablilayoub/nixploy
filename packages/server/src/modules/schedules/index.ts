import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, max } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { applications, compose, deployments, schedules } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { getConfigDir } from "../application/paths";
import { badRequest, conflict } from "../errors";
import { isValidCronExpression } from "./cron";
import { runImageJob } from "./image-job";
import { runScheduleCommand } from "./runner";

const log = createLogger("schedules");

export type { ImageJobCommandInput, ImageJobTarget } from "./image-job";
export {
	assertJobImage,
	buildImageJobCommand,
	jobContainerName,
	jobEnvFilePath,
	runImageJob,
	scheduleTimeoutMs,
} from "./image-job";
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

/** The fields `recordRun` needs — a full schedule row satisfies it. */
interface RunSubject {
	scheduleId: string;
	name: string;
	applicationId?: string | null;
	composeId?: string | null;
	serverId?: string | null;
}

/**
 * Persist a run's output and mirror it into a deployment row for history.
 *
 * The log file is written 0600: a schedule's output regularly contains what
 * its command printed — connection strings, dump paths, API responses — and
 * the config directory is shared with every other on-disk artefact.
 */
async function recordRun(
	row: RunSubject,
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
	await writeFile(logPath, header + result.output, { encoding: "utf8", mode: 0o600 });

	try {
		await db.insert(deployments).values({
			title: `Schedule: ${row.name}`,
			description: result.trigger === "manual" ? "Manual schedule run" : "Scheduled run",
			status: result.status,
			logPath,
			errorMessage: result.errorMessage ?? null,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			applicationId: row.applicationId ?? null,
			composeId: row.composeId ?? null,
			serverId: row.serverId ?? null,
			scheduleId: row.scheduleId,
			trigger: "schedule",
			triggeredBy: `schedule:${row.scheduleId}`,
		});
	} catch (error) {
		log.error(`Failed to record schedule run ${row.scheduleId}`, {
			error: describeErrorWithCause(error),
		});
	}
}

/** Stamp `schedule.last_run_at`. Never fails a run: the marker is advisory. */
async function markScheduleRun(scheduleId: string, at: Date): Promise<void> {
	await db
		.update(schedules)
		.set({ lastRunAt: at })
		.where(eq(schedules.scheduleId, scheduleId))
		.catch((error: unknown) => {
			log.error(`Failed to stamp last_run_at for schedule ${scheduleId}`, {
				error: describeErrorWithCause(error),
			});
		});
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
		throw conflict(`Schedule "${row.name}" is already running — wait for it to finish`);
	}
	inFlight.add(row.scheduleId);
	const state = getState(row.scheduleId);
	const startedAt = new Date();
	state.lastRunAt = startedAt;
	state.lastStatus = "running";
	state.lastError = null;
	// Written BEFORE the command runs, not after: the boot catch-up replays
	// overdue schedules, and a process killed mid-run must not leave a marker
	// that makes the next boot replay the same tick again.
	await markScheduleRun(row.scheduleId, startedAt);

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

export interface RunOnceInput {
	/** Shown in the run log and the deployment row. */
	name: string;
	image: string;
	shellType: "bash" | "sh";
	command: string;
	applicationId?: string | null;
	composeId?: string | null;
}

/**
 * "Run once from an image" — a job with no schedule behind it (product
 * audit, Platform row "no one-off run once from an image").
 *
 * Deliberately does NOT create a `schedule` row: a one-off is not a cron, and
 * a disabled row with an unreachable cron expression would be a worse lie. It
 * still records the same run log + deployment row every scheduled run writes,
 * so the output shows up in the service's history like any other run. The
 * synthetic `once-<uuid>` id is what ties the two together.
 */
export async function runOnceFromImage(input: RunOnceInput): Promise<ScheduleRunResult> {
	const subject: RunSubject = {
		scheduleId: `once-${randomUUID()}`,
		name: input.name,
		applicationId: input.applicationId ?? null,
		composeId: input.composeId ?? null,
	};
	const startedAt = new Date();
	try {
		const output = await runImageJob({
			image: input.image,
			shellType: input.shellType,
			command: input.command,
			applicationId: input.applicationId ?? null,
			composeId: input.composeId ?? null,
		});
		const finishedAt = new Date();
		await recordRun(subject, {
			trigger: "manual",
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
		await recordRun(subject, {
			trigger: "manual",
			status: "error",
			output: [message, stderr].filter(Boolean).join("\n\n"),
			errorMessage: message,
			startedAt,
			finishedAt,
		});
		throw error;
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
			error: describeErrorWithCause(error),
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
		throw badRequest(`Invalid cron expression: ${row.cronExpression}`);
	}
	const job = schedule.scheduleJob(row.scheduleId, row.cronExpression, () => {
		void tickSchedule(row.scheduleId).catch((error) => {
			log.error(`Schedule tick ${row.scheduleId} crashed`, {
				error: describeErrorWithCause(error),
			});
		});
	});
	if (!job) {
		throw badRequest(`Invalid cron expression: ${row.cronExpression}`);
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

/**
 * Next fire time of a cron expression at or after `start`, or null when the
 * expression does not recur. The probe job is cancelled immediately and is
 * unnamed, so it never lands in `schedule.scheduledJobs`.
 */
function nextFireAt(expression: string, start: Date): Date | null {
	const probe = schedule.scheduleJob({ rule: expression.trim(), start }, () => {});
	if (!probe) return null;
	const next = probe.nextInvocation();
	probe.cancel();
	return next ? new Date(next.getTime()) : null;
}

/**
 * Distance between two consecutive fires of a cron expression — node-schedule
 * only exposes the *next* invocation, so the second one is read from a probe
 * job that starts just after the first. Returns null for expressions that
 * fire at most once.
 */
export function cronIntervalMs(expression: string, from: Date = new Date()): number | null {
	const first = nextFireAt(expression, from);
	if (!first) return null;
	const second = nextFireAt(expression, new Date(first.getTime() + 1_000));
	if (!second) return null;
	const interval = second.getTime() - first.getTime();
	return interval > 0 ? interval : null;
}

/**
 * Last recorded run per schedule, derived from the `deployment` row every run
 * writes (`recordRun`). Only needed for rows that predate migration 0023 —
 * `schedule.last_run_at` is the authoritative marker now, and it is the one
 * the catch-up replay trusts because it is written before the command runs.
 */
async function lastRunByScheduleId(scheduleIds: string[]): Promise<Map<string, Date>> {
	if (scheduleIds.length === 0) return new Map();
	const rows = await db
		.select({ scheduleId: deployments.scheduleId, lastRunAt: max(deployments.createdAt) })
		.from(deployments)
		.where(inArray(deployments.scheduleId, scheduleIds))
		.groupBy(deployments.scheduleId);
	const byId = new Map<string, Date>();
	for (const row of rows) {
		if (row.scheduleId && row.lastRunAt) byId.set(row.scheduleId, new Date(row.lastRunAt));
	}
	return byId;
}

export interface OverdueSchedule {
	scheduleId: string;
	name: string;
	cronExpression: string;
	lastRunAt: Date | null;
	missedIntervals: number;
}

/**
 * Schedules whose last run is more than one full interval old — i.e. ticks the
 * panel missed while it was down. node-schedule has no catch-up, so these
 * simply never ran (audit #17). Always reported at boot; replayed once each
 * only when `NIXPLOY_CRON_CATCH_UP=1` (see {@link initSchedules}).
 *
 * `schedule.last_run_at` is the reference. Rows that predate migration 0023
 * have none, so those fall back to the derived lookup (the `deployment` row
 * each run writes) and finally to the row's own creation time. The grace is a
 * full extra interval, so a schedule that fired on time is never reported.
 */
export async function findOverdueSchedules(now: Date = new Date()): Promise<OverdueSchedule[]> {
	const rows = await db.query.schedules.findMany({ where: eq(schedules.enabled, true) });
	const legacy = rows.filter((row) => !row.lastRunAt).map((row) => row.scheduleId);
	const derived = await lastRunByScheduleId(legacy);
	const overdue: OverdueSchedule[] = [];
	for (const row of rows) {
		const interval = cronIntervalMs(row.cronExpression, now);
		if (!interval) continue;
		const lastRunAt = row.lastRunAt ?? derived.get(row.scheduleId) ?? null;
		// Never ran at all: use the row's creation time as the reference.
		const reference = lastRunAt ?? row.createdAt;
		if (!reference) continue;
		const elapsed = now.getTime() - reference.getTime();
		if (elapsed <= interval * 2) continue;
		overdue.push({
			scheduleId: row.scheduleId,
			name: row.name,
			cronExpression: row.cronExpression,
			lastRunAt,
			missedIntervals: Math.floor(elapsed / interval),
		});
	}
	return overdue;
}

/**
 * Replay overdue jobs once at boot. Off by default: re-running an arbitrary
 * shell command hours late is rarely what an operator wants, and a nightly
 * dump that missed its window may be better skipped than run at 11:00. One
 * run per schedule, never one per missed interval, and sequential so a
 * backlog cannot saturate the host.
 */
export function cronCatchUpEnabled(): boolean {
	return process.env.NIXPLOY_CRON_CATCH_UP === "1";
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
				error: describeErrorWithCause(error),
			});
		}
	}
	log.info(`Initialized ${jobs.size} schedules`);

	// node-schedule has no catch-up: ticks missed while the panel was down are
	// gone. Say so instead of leaving the operator to notice a silent gap, and
	// replay them once when the operator opted in.
	try {
		const overdue = await findOverdueSchedules();
		const replay = cronCatchUpEnabled();
		for (const entry of overdue) {
			log.warn(
				`Schedule "${entry.name}" (${entry.cronExpression}) has not run for ~${entry.missedIntervals} intervals`,
				{
					scheduleId: entry.scheduleId,
					lastRunAt: entry.lastRunAt?.toISOString() ?? "never",
					catchUp: replay,
				},
			);
		}
		// Detached: a replay is a real command run and must not hold up boot.
		if (replay && overdue.length > 0) {
			const byId = new Map(rows.map((row) => [row.scheduleId, row]));
			void replayOverdueSchedules(overdue, byId);
		}
	} catch (error) {
		log.error("Could not check for overdue schedules", {
			error: describeErrorWithCause(error),
		});
	}
}

/**
 * Run each overdue schedule once, one after the other. Idempotent across a
 * crash loop: `runSchedule` stamps `last_run_at` before the command starts, so
 * the next boot no longer sees the schedule as overdue.
 */
async function replayOverdueSchedules(
	overdue: OverdueSchedule[],
	byId: Map<string, ScheduleRow>,
): Promise<void> {
	for (const entry of overdue) {
		const row = byId.get(entry.scheduleId);
		if (!row) continue;
		log.info(`Catching up schedule "${row.name}" (${entry.missedIntervals} intervals missed)`, {
			scheduleId: row.scheduleId,
		});
		await runSchedule(row, "cron").catch((error: unknown) => {
			log.error(`Catch-up run of schedule ${row.scheduleId} failed`, {
				error: describeErrorWithCause(error),
			});
		});
	}
}
