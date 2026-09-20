import { eq, inArray, max } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { backupRuns, backups, destinations, volumeBackups } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { cronCatchUpEnabled, cronIntervalMs } from "../schedules";
import { isValidCronExpression } from "../schedules/cron";
import {
	type BackupRow,
	backupServiceExists,
	emitBackupNotification,
	runBackup,
	runVolumeBackup,
	type VolumeBackupRow,
} from "./runner";
import { sanitizeRunError } from "./runs";

const log = createLogger("backups");

/**
 * node-schedule registry for database backups and volume backups. Mirrors
 * the lifecycle of modules/schedules: rows are registered at boot and
 * re-registered by the backup/volume-backup routers on every mutation.
 *
 * Every cron tick re-reads its row and self-unregisters when the row (or the
 * service it dumps) is gone, so a deleted database never keeps producing
 * "Backup Failed" notifications; a per-row in-flight guard keeps slow dumps
 * from overlapping.
 */

const backupJobs = new Map<string, { job: schedule.Job; row: BackupRow }>();
const volumeBackupJobs = new Map<string, { job: schedule.Job; row: VolumeBackupRow }>();
/** `backup:<id>` / `volume:<id>` keys with a run in flight (cron or manual). */
const inFlight = new Set<string>();

/** Syntax-check a cron expression without registering a real job. */
export function isValidBackupCron(cronExpression: string): boolean {
	return isValidCronExpression(cronExpression);
}

async function loadDestination(backupRow: BackupRow | VolumeBackupRow) {
	return await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, backupRow.destinationId),
	});
}

/** Run `fn` under the in-flight guard; manual runs refuse to overlap instead of skipping. */
async function guarded(key: string, trigger: "cron" | "manual", fn: () => Promise<void>) {
	if (inFlight.has(key)) {
		if (trigger === "manual") {
			throw new Error("This backup is already running — wait for it to finish");
		}
		log.warn(`${key} still running — skipping tick`);
		return;
	}
	inFlight.add(key);
	try {
		await fn();
	} finally {
		inFlight.delete(key);
	}
}

/** `backup_run.trigger` value for a scheduler trigger. */
const runTrigger = (trigger: "cron" | "manual") =>
	trigger === "cron" ? ("schedule" as const) : ("manual" as const);

/**
 * Stamp `last_run_at` before the dump starts. Written first, not last, so the
 * boot catch-up cannot replay the same window twice after a crash mid-run;
 * a failed write never fails the backup (the marker is advisory).
 */
async function markRun(
	table: typeof backups | typeof volumeBackups,
	column: typeof backups.backupId | typeof volumeBackups.volumeBackupId,
	id: string,
): Promise<void> {
	await db
		.update(table)
		.set({ lastRunAt: new Date() })
		.where(eq(column, id))
		.catch((error: unknown) => {
			log.error(`Failed to stamp last_run_at for ${id}`, {
				error: describeErrorWithCause(error),
			});
		});
}

async function executeBackup(backupRow: BackupRow, trigger: "cron" | "manual"): Promise<void> {
	const destination = await loadDestination(backupRow);
	await markRun(backups, backups.backupId, backupRow.backupId);
	try {
		await runBackup(backupRow, { trigger: runTrigger(trigger) });
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: backupRow.appName,
				status: "done",
			});
		}
	} catch (error) {
		// Same redaction as the run row: the raw message can embed a full
		// command line (and therefore credentials) that fans out to chat channels.
		const message = sanitizeRunError(error);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: backupRow.appName,
				status: "error",
				errorMessage: message,
			});
		}
		if (trigger === "manual") throw error;
		log.error(`Backup ${backupRow.appName} (${backupRow.backupId}) failed`, {
			error: describeErrorWithCause(error),
		});
	}
}

async function executeVolumeBackup(
	volumeBackup: VolumeBackupRow,
	trigger: "cron" | "manual",
): Promise<void> {
	const destination = await loadDestination(volumeBackup);
	await markRun(volumeBackups, volumeBackups.volumeBackupId, volumeBackup.volumeBackupId);
	try {
		await runVolumeBackup(volumeBackup, { trigger: runTrigger(trigger) });
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: volumeBackup.volumeName,
				status: "done",
			});
		}
	} catch (error) {
		// Same redaction as the run row: the raw message can embed a full
		// command line (and therefore credentials) that fans out to chat channels.
		const message = sanitizeRunError(error);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: volumeBackup.volumeName,
				status: "error",
				errorMessage: message,
			});
		}
		if (trigger === "manual") throw error;
		log.error(`Volume backup ${volumeBackup.volumeName} (${volumeBackup.volumeBackupId}) failed`, {
			error: describeErrorWithCause(error),
		});
	}
}

/** Run a database backup immediately (manual trigger from the router). */
export async function runBackupNow(backupRow: BackupRow): Promise<void> {
	await guarded(`backup:${backupRow.backupId}`, "manual", () => executeBackup(backupRow, "manual"));
}

/** Run a volume backup immediately (manual trigger from the router). */
export async function runVolumeBackupNow(volumeBackup: VolumeBackupRow): Promise<void> {
	await guarded(`volume:${volumeBackup.volumeBackupId}`, "manual", () =>
		executeVolumeBackup(volumeBackup, "manual"),
	);
}

/** Cron tick: re-read the row, drop the job when it or its service is gone, then run. */
async function tickBackup(backupId: string): Promise<void> {
	await guarded(`backup:${backupId}`, "cron", async () => {
		const row = await db.query.backups.findFirst({ where: eq(backups.backupId, backupId) });
		if (!row?.enabled) {
			log.info(`Backup ${backupId} was removed or disabled — unregistering its cron job`);
			unregisterBackupSchedule(backupId);
			return;
		}
		if (!(await backupServiceExists(row))) {
			log.warn(
				`Backup ${row.appName} (${backupId}) has no linked ${row.databaseType} service — unregistering its cron job`,
			);
			unregisterBackupSchedule(backupId);
			return;
		}
		await executeBackup(row, "cron");
	});
}

async function tickVolumeBackup(volumeBackupId: string): Promise<void> {
	await guarded(`volume:${volumeBackupId}`, "cron", async () => {
		const row = await db.query.volumeBackups.findFirst({
			where: eq(volumeBackups.volumeBackupId, volumeBackupId),
		});
		if (!row?.enabled) {
			log.info(`Volume backup ${volumeBackupId} was removed or disabled — unregistering`);
			unregisterVolumeBackupSchedule(volumeBackupId);
			return;
		}
		await executeVolumeBackup(row, "cron");
	});
}

/** (Re)register the cron job for a database backup row. No-op when disabled. */
export function registerBackupSchedule(backupRow: BackupRow): void {
	unregisterBackupSchedule(backupRow.backupId);
	if (!backupRow.enabled) return;
	if (!isValidBackupCron(backupRow.schedule)) {
		throw new Error(`Invalid cron expression: ${backupRow.schedule}`);
	}
	const job = schedule.scheduleJob(`backup-${backupRow.backupId}`, backupRow.schedule, () => {
		void tickBackup(backupRow.backupId).catch((error) => {
			log.error(`Backup tick ${backupRow.backupId} crashed`, {
				error: describeErrorWithCause(error),
			});
		});
	});
	if (!job) {
		throw new Error(`Invalid cron expression: ${backupRow.schedule}`);
	}
	backupJobs.set(backupRow.backupId, { job, row: backupRow });
}

/** Cancel and drop the cron job for a database backup. */
export function unregisterBackupSchedule(backupId: string): void {
	backupJobs.get(backupId)?.job.cancel();
	backupJobs.delete(backupId);
}

/** (Re)register the cron job for a volume backup row. No-op when disabled. */
export function registerVolumeBackupSchedule(volumeBackup: VolumeBackupRow): void {
	unregisterVolumeBackupSchedule(volumeBackup.volumeBackupId);
	if (!volumeBackup.enabled) return;
	if (!isValidBackupCron(volumeBackup.cronExpression)) {
		throw new Error(`Invalid cron expression: ${volumeBackup.cronExpression}`);
	}
	const job = schedule.scheduleJob(
		`volume-backup-${volumeBackup.volumeBackupId}`,
		volumeBackup.cronExpression,
		() => {
			void tickVolumeBackup(volumeBackup.volumeBackupId).catch((error) => {
				log.error(`Volume backup tick ${volumeBackup.volumeBackupId} crashed`, {
					error: describeErrorWithCause(error),
				});
			});
		},
	);
	if (!job) {
		throw new Error(`Invalid cron expression: ${volumeBackup.cronExpression}`);
	}
	volumeBackupJobs.set(volumeBackup.volumeBackupId, { job, row: volumeBackup });
}

/** Cancel and drop the cron job for a volume backup. */
export function unregisterVolumeBackupSchedule(volumeBackupId: string): void {
	volumeBackupJobs.get(volumeBackupId)?.job.cancel();
	volumeBackupJobs.delete(volumeBackupId);
}

/**
 * Cancel every backup + volume-backup cron job attached to a service that is
 * being deleted (database dumps match on `appName`; volume archives on the
 * owning application/compose id). Call it from the service delete paths
 * before/after the row cascade so the captured jobs stop immediately instead
 * of failing every tick until the next tick's self-check. Returns the
 * number of jobs cancelled.
 */
export function unregisterBackupsForService(service: {
	appName: string;
	applicationId?: string | null;
	composeId?: string | null;
}): number {
	let cancelled = 0;
	for (const [backupId, entry] of backupJobs) {
		if (entry.row.appName === service.appName) {
			unregisterBackupSchedule(backupId);
			cancelled += 1;
		}
	}
	for (const [volumeBackupId, entry] of volumeBackupJobs) {
		const matchesApp = service.applicationId && entry.row.applicationId === service.applicationId;
		const matchesCompose = service.composeId && entry.row.composeId === service.composeId;
		if (matchesApp || matchesCompose) {
			unregisterVolumeBackupSchedule(volumeBackupId);
			cancelled += 1;
		}
	}
	return cancelled;
}

/**
 * Last recorded run per backup / volume backup, derived from `backup_run`.
 * Only needed for rows that predate migration 0023 — `backup.last_run_at` /
 * `volume_backup.last_run_at` are the authoritative markers now, and they are
 * the ones the catch-up replay trusts (written before the dump starts).
 */
async function lastRunAt(
	column: typeof backupRuns.backupId | typeof backupRuns.volumeBackupId,
	ids: string[],
): Promise<Map<string, Date>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: column, lastRunAt: max(backupRuns.startedAt) })
		.from(backupRuns)
		.where(inArray(column, ids))
		.groupBy(column);
	const byId = new Map<string, Date>();
	for (const row of rows) {
		if (row.id && row.lastRunAt) byId.set(row.id, new Date(row.lastRunAt));
	}
	return byId;
}

export interface OverdueBackup {
	id: string;
	/** Which table the id belongs to — the catch-up replay needs to know. */
	kind: "database" | "volume";
	label: string;
	cronExpression: string;
	lastRunAt: Date | null;
	missedIntervals: number;
}

/**
 * Backups whose last run is more than one interval old (missed ticks).
 * `last_run_at` is the reference; rows older than migration 0023 have none and
 * fall back to the derived `backup_run` lookup, then to their creation time.
 */
export async function findOverdueBackups(now: Date = new Date()): Promise<OverdueBackup[]> {
	const [backupRows, volumeRows] = await Promise.all([
		db.query.backups.findMany({ where: eq(backups.enabled, true) }),
		db.query.volumeBackups.findMany({ where: eq(volumeBackups.enabled, true) }),
	]);
	const [backupRunsById, volumeRunsById] = await Promise.all([
		lastRunAt(
			backupRuns.backupId,
			backupRows.filter((row) => !row.lastRunAt).map((row) => row.backupId),
		),
		lastRunAt(
			backupRuns.volumeBackupId,
			volumeRows.filter((row) => !row.lastRunAt).map((row) => row.volumeBackupId),
		),
	]);

	const overdue: OverdueBackup[] = [];
	const check = (
		kind: OverdueBackup["kind"],
		id: string,
		label: string,
		cronExpression: string,
		stamped: Date | null,
		createdAt: Date | null,
		runs: Map<string, Date>,
	) => {
		const interval = cronIntervalMs(cronExpression, now);
		if (!interval) return;
		const lastRun = stamped ?? runs.get(id) ?? null;
		const reference = lastRun ?? createdAt;
		if (!reference) return;
		const elapsed = now.getTime() - reference.getTime();
		if (elapsed <= interval * 2) return;
		overdue.push({
			id,
			kind,
			label,
			cronExpression,
			lastRunAt: lastRun,
			missedIntervals: Math.floor(elapsed / interval),
		});
	};

	for (const row of backupRows) {
		check(
			"database",
			row.backupId,
			row.appName,
			row.schedule,
			row.lastRunAt,
			row.createdAt,
			backupRunsById,
		);
	}
	for (const row of volumeRows) {
		check(
			"volume",
			row.volumeBackupId,
			row.volumeName,
			row.cronExpression,
			row.lastRunAt,
			row.createdAt,
			volumeRunsById,
		);
	}
	return overdue;
}

/** Register every enabled backup + volume backup at process boot. */
export async function initBackupSchedules(): Promise<void> {
	const [backupRows, volumeBackupRows] = await Promise.all([
		db.query.backups.findMany({ where: eq(backups.enabled, true) }),
		db.query.volumeBackups.findMany({ where: eq(volumeBackups.enabled, true) }),
	]);
	for (const row of backupRows) {
		try {
			registerBackupSchedule(row);
		} catch (error) {
			log.error(`Failed to register backup ${row.backupId}`, {
				error: describeErrorWithCause(error),
			});
		}
	}
	for (const row of volumeBackupRows) {
		try {
			registerVolumeBackupSchedule(row);
		} catch (error) {
			log.error(`Failed to register volume backup ${row.volumeBackupId}`, {
				error: describeErrorWithCause(error),
			});
		}
	}
	log.info(
		`Initialized ${backupJobs.size} backup schedules, ${volumeBackupJobs.size} volume backup schedules`,
	);

	// node-schedule has no catch-up: a nightly dump that coincided with an
	// update never ran and never will (audit #17). Surface it at boot, and
	// replay it once when the operator opted in with NIXPLOY_CRON_CATCH_UP=1.
	try {
		const overdue = await findOverdueBackups();
		const replay = cronCatchUpEnabled();
		for (const entry of overdue) {
			log.warn(
				`Backup "${entry.label}" (${entry.cronExpression}) has not run for ~${entry.missedIntervals} intervals`,
				{
					id: entry.id,
					lastRunAt: entry.lastRunAt?.toISOString() ?? "never",
					catchUp: replay,
				},
			);
		}
		// Detached: a dump can take minutes and must not hold up boot.
		if (replay && overdue.length > 0) {
			void replayOverdueBackups(overdue, backupRows, volumeBackupRows);
		}
	} catch (error) {
		log.error("Could not check for overdue backups", {
			error: describeErrorWithCause(error),
		});
	}
}

/**
 * Run each overdue backup once, one after the other (never in parallel: a
 * dump is IO-heavy and the in-flight guard is per row, not global).
 * Idempotent across a crash loop — `executeBackup` stamps `last_run_at`
 * before the dump starts, so the next boot no longer sees it as overdue.
 */
async function replayOverdueBackups(
	overdue: OverdueBackup[],
	backupRows: BackupRow[],
	volumeBackupRows: VolumeBackupRow[],
): Promise<void> {
	const byBackupId = new Map(backupRows.map((row) => [row.backupId, row]));
	const byVolumeId = new Map(volumeBackupRows.map((row) => [row.volumeBackupId, row]));
	for (const entry of overdue) {
		log.info(`Catching up backup "${entry.label}" (${entry.missedIntervals} intervals missed)`, {
			id: entry.id,
		});
		if (entry.kind === "database") {
			const row = byBackupId.get(entry.id);
			if (row) await tickBackup(row.backupId);
			continue;
		}
		const row = byVolumeId.get(entry.id);
		if (row) await tickVolumeBackup(row.volumeBackupId);
	}
}
