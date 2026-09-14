import fs from "node:fs/promises";
import path from "node:path";
import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { auditLogs, incidents, previewDeployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { getConfigDir } from "../application/paths";
import { deletePreviewDeployment } from "../preview";
import { getDeploymentExplainPath } from "./paths";

const log = createLogger("deployment-maintenance");

/**
 * Housekeeping cron (hourly):
 * - tears down preview deployments whose `expiresAt` has passed
 * - deletes old `deployment` rows (keeping the newest per service) together
 *   with their `.log` / `.explain.json` files
 * - deletes build logs of deployments that no longer exist, and any log file
 *   older than the retention window
 * - prunes schedule run logs under `<config>/schedules`
 * - caps `incident` and `audit_log` rows
 *
 * Every step is best-effort: a failure on one preview, one row or one file
 * is logged and never stops the pass.
 */

/** Build logs older than this are removed even if their row still exists. */
export const DEPLOYMENT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Deployment rows older than this are deleted once a service has more than {@link DEPLOYMENTS_KEPT_PER_TARGET}. */
export const DEPLOYMENT_ROW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Newest rows always kept per application / compose / schedule. */
export const DEPLOYMENTS_KEPT_PER_TARGET = 50;
/** Schedule run output files older than this are removed. */
export const SCHEDULE_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Resolved incidents are dropped this long after `resolvedAt`. */
export const INCIDENT_RESOLVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Any incident (resolved or not — nothing resolves them yet) is dropped after this. */
export const INCIDENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** Default for `NIXPLOY_AUDIT_RETENTION_DAYS`; `0` keeps audit rows forever. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

const MAINTENANCE_CRON = "7 * * * *";
/** Ids per anti-join query when reconciling on-disk logs with rows. */
const ORPHAN_LOOKUP_CHUNK = 500;

/** `<config>/logs` — one directory of `<deploymentId>.log` files per service. */
const getLogsRoot = (): string => path.join(getConfigDir(), "logs");

/** Where `modules/schedules` writes run output (same resolution as there). */
const getSchedulesLogDir = (): string =>
	process.env.NIXPLOY_SCHEDULES_LOG_PATH ?? path.join(getConfigDir(), "schedules");

/**
 * Drizzle wraps a driver failure in a `DrizzleQueryError` whose message is the
 * SQL and the parameters — the actual reason sits on `cause`. Logging only the
 * message is how a broken maintenance step can fail hourly for weeks while the
 * log says nothing but "Failed query: …".
 */
const errorMessage = (error: unknown): string => {
	if (!(error instanceof Error)) return String(error);
	const cause = (error as { cause?: unknown }).cause;
	const causeMessage = cause instanceof Error ? cause.message : null;
	return causeMessage ? `${error.message} — cause: ${causeMessage}` : error.message;
};

/**
 * Audit retention in days from the env value: unset → default, `0` → keep
 * forever, anything unparsable or negative → default.
 */
export function resolveAuditRetentionDays(raw = process.env.NIXPLOY_AUDIT_RETENTION_DAYS): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_AUDIT_RETENTION_DAYS;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== raw.trim()) {
		return DEFAULT_AUDIT_RETENTION_DAYS;
	}
	return parsed;
}

/**
 * Delete previews past their expiry. Returns how many were torn down.
 * Previews created from webhooks have no expiry and are only removed when the
 * pull request closes; `expiresAt` is for the manual/API case where nobody
 * closes anything.
 */
export async function expirePreviewDeployments(now = new Date()): Promise<number> {
	const expired = await db
		.select({
			previewDeploymentId: previewDeployments.previewDeploymentId,
			appName: previewDeployments.appName,
		})
		.from(previewDeployments)
		.where(and(isNotNull(previewDeployments.expiresAt), lt(previewDeployments.expiresAt, now)));

	let removed = 0;
	for (const preview of expired) {
		try {
			await deletePreviewDeployment(preview.previewDeploymentId);
			removed += 1;
			log.info(`Expired preview deployment ${preview.appName}`);
		} catch (error) {
			log.error(`Failed to expire preview deployment ${preview.appName}`, {
				error: errorMessage(error),
			});
		}
	}
	return removed;
}

/**
 * Remove a deployment's on-disk artifacts: the build log and its Deploy
 * Copilot sidecar. Missing files are fine. Returns how many files went away.
 */
export async function removeDeploymentArtifacts(logPaths: Iterable<string>): Promise<number> {
	let removed = 0;
	for (const logPath of logPaths) {
		if (!logPath || !path.isAbsolute(logPath) || !logPath.endsWith(".log")) continue;
		for (const file of [logPath, getDeploymentExplainPath(logPath)]) {
			try {
				await fs.rm(file);
				removed += 1;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				log.error(`Failed to remove deployment artifact ${file}`, { error: errorMessage(error) });
			}
		}
	}
	return removed;
}

/**
 * Delete deployment rows that are both older than `retentionMs` and beyond
 * the newest `keepPerTarget` of their service — a schedule run belongs to
 * its schedule, everything else to its application or compose. Rows still
 * `queued` / `running` and rows a rollback snapshot points at are never touched. The
 * `.log` / `.explain.json` files of deleted rows are removed too.
 *
 * Schedules insert one row per tick (`* * * * *` = 1 440/day), which is why
 * the cap is per target and not global.
 */
export async function pruneDeploymentRows(
	options: { keepPerTarget?: number; retentionMs?: number; now?: Date } = {},
): Promise<{ rows: number; files: number }> {
	const keep = Math.max(0, options.keepPerTarget ?? DEPLOYMENTS_KEPT_PER_TARGET);
	const now = options.now ?? new Date();
	const cutoff = new Date(now.getTime() - (options.retentionMs ?? DEPLOYMENT_ROW_RETENTION_MS));

	// The cutoff goes in as an ISO string, not a Date: `db.execute` sends a raw
	// statement through postgres-js's unsafe path, which cannot serialize a JS
	// Date. Passing one made every hourly run fail with ERR_INVALID_ARG_TYPE —
	// drizzle reported it as "Failed query: …" with the real cause hidden — so
	// deployment rows and their log files were never pruned on any install.
	const deleted = (await db.execute(sql`
		WITH ranked AS (
			SELECT deployment_id,
				row_number() OVER (
					PARTITION BY coalesce(schedule_id, application_id, compose_id, '')
					ORDER BY created_at DESC
				) AS position
			FROM deployment
		)
		DELETE FROM deployment AS d
		USING ranked AS r
		WHERE d.deployment_id = r.deployment_id
			AND r.position > ${keep}
			AND d.created_at < ${cutoff.toISOString()}::timestamptz
			AND d.status NOT IN ('running', 'queued')
			AND NOT EXISTS (SELECT 1 FROM rollback AS rb WHERE rb.deployment_id = d.deployment_id)
		RETURNING d.log_path
	`)) as unknown as Iterable<{ log_path: string | null }>;

	let rows = 0;
	const logPaths: string[] = [];
	for (const row of deleted) {
		rows += 1;
		if (row.log_path) logPaths.push(row.log_path);
	}
	const files = await removeDeploymentArtifacts(logPaths);
	if (rows > 0) {
		log.info(`Pruned ${rows} old deployment row(s) and ${files} file(s)`);
	}
	return { rows, files };
}

/**
 * Of the given deployment ids, the ones with no row left — a SQL anti-join
 * over the id list, so the table is never loaded into memory.
 */
export async function findOrphanDeploymentIds(ids: string[]): Promise<Set<string>> {
	const orphans = new Set<string>();
	for (let start = 0; start < ids.length; start += ORPHAN_LOOKUP_CHUNK) {
		const chunk = ids.slice(start, start + ORPHAN_LOOKUP_CHUNK);
		const rows = (await db.execute(sql`
			SELECT f.id
			FROM unnest(${sql.param(chunk)}::text[]) AS f(id)
			WHERE NOT EXISTS (SELECT 1 FROM deployment AS d WHERE d.deployment_id = f.id)
		`)) as unknown as Iterable<{ id: string }>;
		for (const row of rows) orphans.add(row.id);
	}
	return orphans;
}

/**
 * Remove build logs on disk that no live deployment row points at, plus any
 * log older than {@link DEPLOYMENT_LOG_RETENTION_MS}. Deployment rows cascade
 * away with their service, but the files under `<config>/logs/<appName>` do
 * not, so without this the directory grows forever.
 */
export async function pruneDeploymentLogs(
	retentionMs = DEPLOYMENT_LOG_RETENTION_MS,
): Promise<number> {
	const logsRoot = getLogsRoot();
	let serviceDirs: string[];
	try {
		serviceDirs = await fs.readdir(logsRoot);
	} catch {
		return 0; // nothing has been deployed yet
	}

	const cutoff = Date.now() - retentionMs;
	let removed = 0;

	for (const serviceDir of serviceDirs) {
		const dir = path.join(logsRoot, serviceDir);
		let files: string[];
		try {
			files = await fs.readdir(dir);
		} catch {
			continue;
		}
		// Recent logs are only removed when their row is gone; the lookup is
		// one anti-join per directory over the ids still on disk.
		const recent = new Map<string, string>();
		for (const file of files) {
			if (!file.endsWith(".log")) continue;
			const deploymentId = file.slice(0, -".log".length);
			const filePath = path.join(dir, file);
			try {
				const stats = await fs.stat(filePath);
				if (stats.mtimeMs >= cutoff) {
					recent.set(deploymentId, filePath);
					continue;
				}
				removed += await removeDeploymentArtifacts([filePath]);
			} catch (error) {
				log.error(`Failed to prune deployment log ${filePath}`, { error: errorMessage(error) });
			}
		}
		if (recent.size > 0) {
			try {
				const orphans = await findOrphanDeploymentIds([...recent.keys()]);
				removed += await removeDeploymentArtifacts(
					[...orphans].map((id) => recent.get(id)).filter((p): p is string => Boolean(p)),
				);
			} catch (error) {
				log.error(`Failed to reconcile deployment logs in ${dir}`, { error: errorMessage(error) });
			}
		}
		// Drop the service directory once it holds no logs at all.
		await fs.rmdir(dir).catch(() => {});
	}
	return removed;
}

/**
 * Remove schedule run output (`<config>/schedules/<scheduleId>-<ts>.log`)
 * older than {@link SCHEDULE_LOG_RETENTION_MS}. The matching deployment rows
 * are capped by {@link pruneDeploymentRows}; a row whose file is gone simply
 * shows an empty log, like an expired build log.
 */
export async function pruneScheduleLogs(retentionMs = SCHEDULE_LOG_RETENTION_MS): Promise<number> {
	const dir = getSchedulesLogDir();
	let files: string[];
	try {
		files = await fs.readdir(dir);
	} catch {
		return 0; // no schedule has run yet
	}
	const cutoff = Date.now() - retentionMs;
	let removed = 0;
	for (const file of files) {
		if (!file.endsWith(".log")) continue;
		const filePath = path.join(dir, file);
		try {
			const stats = await fs.stat(filePath);
			if (stats.mtimeMs >= cutoff) continue;
			await fs.rm(filePath, { force: true });
			removed += 1;
		} catch (error) {
			log.error(`Failed to prune schedule log ${filePath}`, { error: errorMessage(error) });
		}
	}
	return removed;
}

/**
 * Drop incidents resolved more than {@link INCIDENT_RESOLVED_RETENTION_MS}
 * ago, and any incident older than {@link INCIDENT_MAX_AGE_MS}.
 */
export async function pruneIncidents(now = new Date()): Promise<number> {
	const resolvedCutoff = new Date(now.getTime() - INCIDENT_RESOLVED_RETENTION_MS);
	const ageCutoff = new Date(now.getTime() - INCIDENT_MAX_AGE_MS);
	const deleted = await db
		.delete(incidents)
		.where(
			or(
				and(isNotNull(incidents.resolvedAt), lt(incidents.resolvedAt, resolvedCutoff)),
				lt(incidents.createdAt, ageCutoff),
			),
		)
		.returning({ incidentId: incidents.incidentId });
	return deleted.length;
}

/**
 * Drop audit rows older than `NIXPLOY_AUDIT_RETENTION_DAYS` (default 365;
 * `0` keeps everything).
 */
export async function pruneAuditLogs(
	retentionDays = resolveAuditRetentionDays(),
	now = new Date(),
): Promise<number> {
	if (retentionDays <= 0) return 0;
	const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
	const deleted = await db
		.delete(auditLogs)
		.where(lt(auditLogs.createdAt, cutoff))
		.returning({ auditId: auditLogs.auditId });
	return deleted.length;
}

/** Remove every build log of one service (called when the service is deleted). */
export async function removeServiceLogs(appName: string): Promise<void> {
	await fs.rm(path.join(getLogsRoot(), appName), { recursive: true, force: true });
}

/** One full housekeeping pass; each step is isolated so one failure never skips the rest. */
export async function runMaintenancePass(): Promise<void> {
	const steps: Array<[string, () => Promise<unknown>]> = [
		["expire previews", expirePreviewDeployments],
		["prune deployment rows", () => pruneDeploymentRows()],
		["prune deployment logs", () => pruneDeploymentLogs()],
		["prune schedule logs", () => pruneScheduleLogs()],
		["prune incidents", () => pruneIncidents()],
		["prune audit log", () => pruneAuditLogs()],
	];
	for (const [label, step] of steps) {
		try {
			await step();
		} catch (error) {
			log.error(`Maintenance step "${label}" failed`, { error: errorMessage(error) });
		}
	}
}

let started = false;
let inFlight = false;

/** Register the hourly housekeeping cron (idempotent). */
export function initDeploymentMaintenance(): void {
	if (started) return; // tsx watch / HMR re-invocations must not double-register
	started = true;
	schedule.scheduleJob("deployment-maintenance", MAINTENANCE_CRON, async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await runMaintenancePass();
		} finally {
			inFlight = false;
		}
	});
}
