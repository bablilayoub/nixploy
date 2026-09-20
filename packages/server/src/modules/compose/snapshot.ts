import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { compose, composeDeploymentSnapshots, deployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";

/**
 * Compose rollbacks (product audit, Databases row "Rollbacks exist only for
 * applications").
 *
 * An application rolls back to a pinned IMAGE; a compose stack has no single
 * image, so the rollback target is the *input* of the deploy — the compose
 * body and the env that rendered it. Every render writes one row here
 * (`prepareComposeFiles`), and `compose.rollback` restores that body + the
 * service-level env onto the row and enqueues a normal deployment.
 *
 * Restoring the SERVICE env (not the merged one) is deliberate: writing the
 * merged env back would permanently absorb every inherited project /
 * environment variable into the service row and break inheritance from then
 * on. The merged env is stored alongside so the UI can show exactly what the
 * snapshot ran with, and so a rollback's result can be compared against it.
 */

const log = createLogger("compose-snapshot");

/** Snapshots kept per compose service; older rows are pruned after each write. */
export const COMPOSE_SNAPSHOT_LIMIT = 10;

export type ComposeSnapshotRow = typeof composeDeploymentSnapshots.$inferSelect;

export interface RecordComposeSnapshotInput {
	composeId: string;
	deploymentId: string;
	/** Compose body that was rendered (raw row content, or the file in the checkout). */
	sourceFile: string;
	/** `docker-compose.nixploy.yml` as Docker saw it. */
	renderedFile: string;
	/** The compose row's own `env` at deploy time. */
	serviceEnv: string | null;
	/** Resolved project → environment → service env used by the render. */
	mergedEnv: string | null;
}

/**
 * The deployment a render belongs to when the caller did not say.
 *
 * The queue claims a row (`queued` → `running`) before the worker calls
 * `prepareComposeFiles`, and the per-app mutex guarantees at most one running
 * job per compose service — so the newest running row for this compose IS the
 * current job. `prepareComposeFiles` called outside a deployment (compose
 * start/stop/delete) resolves nothing and simply writes no snapshot.
 */
export async function resolveCurrentDeploymentId(composeId: string): Promise<string | null> {
	const row = await db.query.deployments.findFirst({
		where: and(eq(deployments.composeId, composeId), eq(deployments.status, "running")),
		orderBy: desc(deployments.createdAt),
		columns: { deploymentId: true },
	});
	return row?.deploymentId ?? null;
}

/**
 * Persist what this deployment deploys. One row per deployment: the first
 * writer wins, so a `compose.start` racing the worker cannot overwrite the
 * job's own snapshot. Never throws — a snapshot is a convenience, not a
 * precondition for deploying.
 */
export async function recordComposeSnapshot(input: RecordComposeSnapshotInput): Promise<void> {
	try {
		await db
			.insert(composeDeploymentSnapshots)
			.values({
				deploymentId: input.deploymentId,
				composeId: input.composeId,
				sourceFile: input.sourceFile,
				renderedFile: input.renderedFile,
				serviceEnv: input.serviceEnv,
				mergedEnv: input.mergedEnv,
			})
			.onConflictDoNothing({ target: composeDeploymentSnapshots.deploymentId });
		await pruneComposeSnapshots(input.composeId);
	} catch (error) {
		log.error(`Failed to record compose snapshot for ${input.composeId}`, {
			error: describeErrorWithCause(error),
		});
	}
}

/** Trim a compose service's snapshots to the newest {@link COMPOSE_SNAPSHOT_LIMIT}. */
export async function pruneComposeSnapshots(composeId: string): Promise<number> {
	const rows = await db.query.composeDeploymentSnapshots.findMany({
		where: eq(composeDeploymentSnapshots.composeId, composeId),
		orderBy: desc(composeDeploymentSnapshots.createdAt),
		columns: { snapshotId: true },
	});
	const stale = rows.slice(COMPOSE_SNAPSHOT_LIMIT);
	if (stale.length === 0) return 0;
	await db.delete(composeDeploymentSnapshots).where(
		inArray(
			composeDeploymentSnapshots.snapshotId,
			stale.map((row) => row.snapshotId),
		),
	);
	return stale.length;
}

export interface ComposeRollbackTarget {
	snapshotId: string;
	deploymentId: string;
	createdAt: Date;
	/** Deployment the snapshot was captured for (null when it was pruned). */
	deployment: {
		title: string;
		description: string | null;
		status: string;
		commitSha: string | null;
		commitMessage: string | null;
		finishedAt: Date | null;
	} | null;
}

/**
 * Rollback targets of a compose service, newest first. Only snapshots whose
 * deployment SUCCEEDED are offered: rolling back to a body that never came up
 * is not a rollback.
 */
export async function listComposeRollbackTargets(
	composeId: string,
): Promise<ComposeRollbackTarget[]> {
	const rows = await db.query.composeDeploymentSnapshots.findMany({
		where: eq(composeDeploymentSnapshots.composeId, composeId),
		orderBy: desc(composeDeploymentSnapshots.createdAt),
		with: { deployment: true },
	});
	return rows
		.filter((row) => row.deployment?.status === "done")
		.map((row) => ({
			snapshotId: row.snapshotId,
			deploymentId: row.deploymentId,
			createdAt: row.createdAt,
			deployment: row.deployment
				? {
						title: row.deployment.title,
						description: row.deployment.description,
						status: row.deployment.status,
						commitSha: row.deployment.commitSha,
						commitMessage: row.deployment.commitMessage,
						finishedAt: row.deployment.finishedAt,
					}
				: null,
		}));
}

/** One snapshot of a compose service, or null when it belongs to another service. */
export async function findComposeSnapshot(
	composeId: string,
	snapshotId: string,
): Promise<ComposeSnapshotRow | null> {
	const row = await db.query.composeDeploymentSnapshots.findFirst({
		where: and(
			eq(composeDeploymentSnapshots.snapshotId, snapshotId),
			eq(composeDeploymentSnapshots.composeId, composeId),
		),
	});
	return row ?? null;
}

/** The snapshot captured for one deployment (the id the history shows). */
export async function findComposeSnapshotByDeployment(
	composeId: string,
	deploymentId: string,
): Promise<ComposeSnapshotRow | null> {
	const row = await db.query.composeDeploymentSnapshots.findFirst({
		where: and(
			eq(composeDeploymentSnapshots.deploymentId, deploymentId),
			eq(composeDeploymentSnapshots.composeId, composeId),
		),
	});
	return row ?? null;
}

export interface RestoreComposeSnapshotResult {
	/** True when the compose body itself was restored (raw sources only). */
	restoredComposeFile: boolean;
	/** True when the service-level env was restored. */
	restoredEnv: boolean;
}

/**
 * Put a snapshot's inputs back on the compose row. The caller enqueues the
 * deployment afterwards (`queueDeployment` — a module never deploys).
 *
 * - raw sources: the compose body and the service env are both restored, so
 *   the next render reproduces the snapshot exactly (assuming project and
 *   environment env have not changed meanwhile).
 * - git sources: the body lives in the repository and stays the authority;
 *   only the env is restored. The router tells the caller which happened.
 */
export async function restoreComposeSnapshot(
	row: { composeId: string; sourceType: string },
	snapshot: ComposeSnapshotRow,
): Promise<RestoreComposeSnapshotResult> {
	const restoredComposeFile = row.sourceType === "raw";
	await db
		.update(compose)
		.set({
			...(restoredComposeFile ? { composeFile: snapshot.sourceFile } : {}),
			env: snapshot.serviceEnv ?? "",
		})
		.where(eq(compose.composeId, row.composeId));
	return { restoredComposeFile, restoredEnv: true };
}
