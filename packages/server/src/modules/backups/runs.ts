import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { type BackupRun, type BackupRunKind, backupRuns } from "../../db/schema";
import { createLogger } from "../../lib/logger";

/**
 * Backup run history (`backup_run` rows).
 *
 * Every execution of a database dump, volume archive, instance export or
 * restore verification is recorded as one row: inserted as `running` before
 * any work starts and finalised as `success` (bytes + object key) or `error`
 * (redacted message). The lists in the UI badge each backup with its last
 * run, and the runs sheet shows the recent history. Retention keeps the
 * newest {@link BACKUP_RUN_RETENTION} rows per backup.
 */

const log = createLogger("backups");

/** Rows kept per backup / volume backup (older ones are pruned after each run). */
export const BACKUP_RUN_RETENTION = 200;

/** Upper bound of the error text stored on a run row. */
const MAX_ERROR_LENGTH = 2000;

/** What started the run: the cron scheduler, an operator, or a restore verification. */
export type BackupRunTrigger = "schedule" | "manual" | "verify";

/** Which backup a run belongs to (instance runs live under their `web-server` backup row). */
export type BackupRunScope = { backupId: string } | { volumeBackupId: string };

export interface StartBackupRunInput {
	kind: BackupRunKind;
	scope: BackupRunScope;
	organizationId: string;
	destinationId: string | null;
	trigger: BackupRunTrigger;
	/** Pre-known object key (verify runs check an existing object). */
	objectKey?: string | null;
}

export type FinishBackupRunInput =
	| { status: "success"; bytes?: number | null; objectKey?: string | null }
	| { status: "error"; error: string };

function scopeWhere(scope: BackupRunScope) {
	return "backupId" in scope
		? eq(backupRuns.backupId, scope.backupId)
		: eq(backupRuns.volumeBackupId, scope.volumeBackupId);
}

/**
 * Error text safe to persist and show in the UI. exec failures embed the
 * full command line (`Command failed: <cmd>\n<stderr>`): keep the program
 * name only, mirroring the `commandLabel` discipline of utils/exec. Known
 * secrets (S3 keys, database passwords) are masked defensively and the text
 * is capped so a chatty tool cannot bloat the row.
 */
export function sanitizeRunError(
	error: unknown,
	secrets: ReadonlyArray<string | null | undefined> = [],
): string {
	let message = error instanceof Error ? error.message : String(error);
	message = message.replace(/^Command failed: (\S+)[^\n]*/, "Command failed: $1");
	for (const secret of secrets) {
		if (secret && secret.length >= 4) {
			message = message.split(secret).join("[redacted]");
		}
	}
	message = message.trim();
	if (message.length === 0) return "Unknown error";
	return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

/** Insert the `running` row; returns its id. */
export async function startBackupRun(input: StartBackupRunInput): Promise<string> {
	const [row] = await db
		.insert(backupRuns)
		.values({
			kind: input.kind,
			backupId: "backupId" in input.scope ? input.scope.backupId : null,
			volumeBackupId: "volumeBackupId" in input.scope ? input.scope.volumeBackupId : null,
			organizationId: input.organizationId,
			destinationId: input.destinationId,
			trigger: input.trigger,
			status: "running",
			objectKey: input.objectKey ?? null,
		})
		.returning({ backupRunId: backupRuns.backupRunId });
	if (!row) {
		throw new Error("Failed to record the backup run");
	}
	return row.backupRunId;
}

/** Finalise a run as success or error (sets `finishedAt`). */
export async function finishBackupRun(runId: string, result: FinishBackupRunInput): Promise<void> {
	await db
		.update(backupRuns)
		.set(
			result.status === "success"
				? {
						status: "success",
						finishedAt: new Date(),
						bytes: result.bytes ?? null,
						objectKey: result.objectKey ?? null,
						error: null,
					}
				: { status: "error", finishedAt: new Date(), error: result.error },
		)
		.where(eq(backupRuns.backupRunId, runId));
}

/** Delete every run of the scope beyond the newest `keep`. */
export async function pruneBackupRuns(
	scope: BackupRunScope,
	keep = BACKUP_RUN_RETENTION,
): Promise<number> {
	const stale = await db
		.select({ backupRunId: backupRuns.backupRunId })
		.from(backupRuns)
		.where(scopeWhere(scope))
		.orderBy(desc(backupRuns.startedAt))
		.offset(keep);
	if (stale.length === 0) return 0;
	await db.delete(backupRuns).where(
		inArray(
			backupRuns.backupRunId,
			stale.map((row) => row.backupRunId),
		),
	);
	return stale.length;
}

/** Newest-first history of one backup / volume backup. */
export async function listBackupRuns(scope: BackupRunScope, limit: number): Promise<BackupRun[]> {
	return await db
		.select()
		.from(backupRuns)
		.where(scopeWhere(scope))
		.orderBy(desc(backupRuns.startedAt))
		.limit(limit);
}

/**
 * Latest run per backup (or volume backup), for list badges — one query
 * regardless of how many rows are listed.
 */
export async function latestBackupRuns(
	scope: { backupIds: string[] } | { volumeBackupIds: string[] },
): Promise<Map<string, BackupRun>> {
	const result = new Map<string, BackupRun>();
	const column = "backupIds" in scope ? backupRuns.backupId : backupRuns.volumeBackupId;
	const ids = "backupIds" in scope ? scope.backupIds : scope.volumeBackupIds;
	if (ids.length === 0) return result;
	const rows = await db
		.selectDistinctOn([column])
		.from(backupRuns)
		.where(inArray(column, ids))
		.orderBy(column, desc(backupRuns.startedAt));
	for (const row of rows) {
		const id = "backupIds" in scope ? row.backupId : row.volumeBackupId;
		if (id) result.set(id, row);
	}
	return result;
}

/** Handle passed to the work function of {@link withBackupRun}. */
export interface BackupRunHandle {
	runId: string;
	/** Register values to mask out of a stored error message (passwords, keys). */
	redact(...values: ReadonlyArray<string | null | undefined>): void;
}

/**
 * Run `work` under a `backup_run` row: `running` → `success` (with the key
 * and size the work returns) or `error` (sanitised message), then prune the
 * scope's history. History bookkeeping never masks the work's own outcome:
 * a failed status update is logged and the original result/error wins.
 */
export async function withBackupRun<T extends { key?: string | null; bytes?: number | null }>(
	input: StartBackupRunInput & { secrets?: ReadonlyArray<string | null | undefined> },
	work: (run: BackupRunHandle) => Promise<T>,
): Promise<T> {
	const secrets: Array<string | null | undefined> = [...(input.secrets ?? [])];
	const runId = await startBackupRun(input);
	const handle: BackupRunHandle = {
		runId,
		redact: (...values) => {
			secrets.push(...values);
		},
	};
	const settle = async (result: FinishBackupRunInput) => {
		try {
			await finishBackupRun(runId, result);
			await pruneBackupRuns(input.scope);
		} catch (error) {
			log.error(`Failed to finalise backup run ${runId}`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
	try {
		const result = await work(handle);
		await settle({
			status: "success",
			bytes: result.bytes ?? null,
			objectKey: result.key ?? input.objectKey ?? null,
		});
		return result;
	} catch (error) {
		await settle({ status: "error", error: sanitizeRunError(error, secrets) });
		throw error;
	}
}
