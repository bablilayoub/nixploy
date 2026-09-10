import { eq } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { backups, destinations, volumeBackups } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { isValidCronExpression } from "../schedules/cron";
import {
	type BackupRow,
	backupServiceExists,
	emitBackupNotification,
	runBackup,
	runVolumeBackup,
	type VolumeBackupRow,
} from "./runner";

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

async function executeBackup(backupRow: BackupRow, trigger: "cron" | "manual"): Promise<void> {
	const destination = await loadDestination(backupRow);
	try {
		await runBackup(backupRow);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: backupRow.appName,
				status: "done",
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: backupRow.appName,
				status: "error",
				errorMessage: message,
			});
		}
		if (trigger === "manual") throw error;
		log.error(`Backup ${backupRow.appName} (${backupRow.backupId}) failed`, {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function executeVolumeBackup(
	volumeBackup: VolumeBackupRow,
	trigger: "cron" | "manual",
): Promise<void> {
	const destination = await loadDestination(volumeBackup);
	try {
		await runVolumeBackup(volumeBackup);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: volumeBackup.volumeName,
				status: "done",
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (destination) {
			await emitBackupNotification(destination, {
				serviceName: volumeBackup.volumeName,
				status: "error",
				errorMessage: message,
			});
		}
		if (trigger === "manual") throw error;
		log.error(`Volume backup ${volumeBackup.volumeName} (${volumeBackup.volumeBackupId}) failed`, {
			error: error instanceof Error ? error.message : String(error),
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
				error: error instanceof Error ? error.message : String(error),
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
					error: error instanceof Error ? error.message : String(error),
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
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	for (const row of volumeBackupRows) {
		try {
			registerVolumeBackupSchedule(row);
		} catch (error) {
			log.error(`Failed to register volume backup ${row.volumeBackupId}`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log.info(
		`Initialized ${backupJobs.size} backup schedules, ${volumeBackupJobs.size} volume backup schedules`,
	);
}
