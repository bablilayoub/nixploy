import fs from "node:fs/promises";
import path from "node:path";
import { and, isNotNull, lt } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { previewDeployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { getConfigDir } from "../application/paths";
import { deletePreviewDeployment } from "../preview";

const log = createLogger("deployment-maintenance");

/**
 * Housekeeping cron (hourly):
 * - tears down preview deployments whose `expiresAt` has passed
 * - deletes build logs of deployments that no longer exist, and any log file
 *   older than the retention window
 *
 * Both are best-effort: a failure on one preview or one file is logged and
 * never stops the pass.
 */

/** Build logs older than this are removed even if their row still exists. */
export const DEPLOYMENT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MAINTENANCE_CRON = "7 * * * *";

/** `<config>/logs` — one directory of `<deploymentId>.log` files per service. */
const getLogsRoot = (): string => path.join(getConfigDir(), "logs");

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
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return removed;
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

	const live = new Set(
		(await db.query.deployments.findMany({ columns: { deploymentId: true } })).map(
			(row) => row.deploymentId,
		),
	);
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
		for (const file of files) {
			if (!file.endsWith(".log")) continue;
			const deploymentId = file.slice(0, -".log".length);
			const filePath = path.join(dir, file);
			try {
				const stats = await fs.stat(filePath);
				if (live.has(deploymentId) && stats.mtimeMs >= cutoff) continue;
				await fs.rm(filePath, { force: true });
				removed += 1;
			} catch (error) {
				log.error(`Failed to prune deployment log ${filePath}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		// Drop the service directory once it holds no logs at all.
		await fs.rmdir(dir).catch(() => {});
	}
	return removed;
}

/** Remove every build log of one service (called when the service is deleted). */
export async function removeServiceLogs(appName: string): Promise<void> {
	await fs.rm(path.join(getLogsRoot(), appName), { recursive: true, force: true });
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
			await expirePreviewDeployments();
			await pruneDeploymentLogs();
		} catch (error) {
			log.error("Deployment maintenance pass failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			inFlight = false;
		}
	});
}
