import { eq } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { backups, destinations, volumeBackups } from "../../db/schema";
import {
	type BackupRow,
	emitBackupNotification,
	runBackup,
	runVolumeBackup,
	type VolumeBackupRow,
} from "./runner";

/**
 * node-schedule registry for database backups and volume backups. Mirrors
 * the lifecycle of modules/schedules: rows are registered at boot and
 * re-registered by the backup/volume-backup routers on every mutation.
 */

const backupJobs = new Map<string, schedule.Job>();
const volumeBackupJobs = new Map<string, schedule.Job>();

/** Syntax-check a cron expression without registering a real job. */
export function isValidBackupCron(cronExpression: string): boolean {
	const probe = schedule.scheduleJob(cronExpression, () => {});
	if (!probe) return false;
	probe.cancel();
	return true;
}

async function loadDestination(backupRow: BackupRow | VolumeBackupRow) {
	return await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, backupRow.destinationId),
	});
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
		console.error(`Backup ${backupRow.appName} (${backupRow.backupId}) failed:`, error);
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
		console.error(
			`Volume backup ${volumeBackup.volumeName} (${volumeBackup.volumeBackupId}) failed:`,
			error,
		);
	}
}

/** Run a database backup immediately (manual trigger from the router). */
export async function runBackupNow(backupRow: BackupRow): Promise<void> {
	await executeBackup(backupRow, "manual");
}

/** Run a volume backup immediately (manual trigger from the router). */
export async function runVolumeBackupNow(volumeBackup: VolumeBackupRow): Promise<void> {
	await executeVolumeBackup(volumeBackup, "manual");
}

/** (Re)register the cron job for a database backup row. No-op when disabled. */
export function registerBackupSchedule(backupRow: BackupRow): void {
	unregisterBackupSchedule(backupRow.backupId);
	if (!backupRow.enabled) return;
	const job = schedule.scheduleJob(`backup-${backupRow.backupId}`, backupRow.schedule, () => {
		void executeBackup(backupRow, "cron");
	});
	if (!job) {
		throw new Error(`Invalid cron expression: ${backupRow.schedule}`);
	}
	backupJobs.set(backupRow.backupId, job);
}

/** Cancel and drop the cron job for a database backup. */
export function unregisterBackupSchedule(backupId: string): void {
	backupJobs.get(backupId)?.cancel();
	backupJobs.delete(backupId);
}

/** (Re)register the cron job for a volume backup row. No-op when disabled. */
export function registerVolumeBackupSchedule(volumeBackup: VolumeBackupRow): void {
	unregisterVolumeBackupSchedule(volumeBackup.volumeBackupId);
	if (!volumeBackup.enabled) return;
	const job = schedule.scheduleJob(
		`volume-backup-${volumeBackup.volumeBackupId}`,
		volumeBackup.cronExpression,
		() => {
			void executeVolumeBackup(volumeBackup, "cron");
		},
	);
	if (!job) {
		throw new Error(`Invalid cron expression: ${volumeBackup.cronExpression}`);
	}
	volumeBackupJobs.set(volumeBackup.volumeBackupId, job);
}

/** Cancel and drop the cron job for a volume backup. */
export function unregisterVolumeBackupSchedule(volumeBackupId: string): void {
	volumeBackupJobs.get(volumeBackupId)?.cancel();
	volumeBackupJobs.delete(volumeBackupId);
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
			console.error(`Failed to register backup ${row.backupId}:`, error);
		}
	}
	for (const row of volumeBackupRows) {
		try {
			registerVolumeBackupSchedule(row);
		} catch (error) {
			console.error(`Failed to register volume backup ${row.volumeBackupId}:`, error);
		}
	}
	console.log(
		`Initialized ${backupJobs.size} backup schedules, ${volumeBackupJobs.size} volume backup schedules`,
	);
}
