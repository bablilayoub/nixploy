import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { deploymentEvents } from "./events";
import { publishDeploymentStatusDetached } from "./notify";
import { refreshQueueSnapshot, startQueueLoop } from "./queue";

const INTERRUPTED_MESSAGE = "Interrupted: Nixploy restarted while this deployment was in flight";

export interface RecoveryResult {
	/** Rows that were `running` (or unplaceable) and had to be failed. */
	interrupted: number;
	/** `queued` rows the worker loop will claim, oldest first. */
	requeued: number;
}

/**
 * Boot-time repair of the deployment table.
 *
 * Rows left `running` by a restart (deploy of Nixploy itself, crash, host
 * reboot) would stay `running` forever, which is not just cosmetic: the
 * status reconciler skips any service that has a running deployment, so one
 * zombie row freezes status corrections for that service indefinitely — and
 * the durable queue's per-app mutex (`NOT EXISTS … status = 'running'`) would
 * refuse to ever build that app again. They are failed here, before the claim
 * loop starts.
 *
 * `queued` rows need nothing: the queue claims them straight from Postgres in
 * creation order, so the backlog survives the restart on its own. (Graceful
 * shutdown leaves them `queued` on purpose — see `queue.ts#drainQueue`.)
 * Previews included since migration 0023 — the row now carries `app_name` and
 * `preview_deployment_id`, everything the worker needs to rebuild the job.
 * The only queued rows failed here are the ones the claim query can never
 * place: `app_name IS NULL` (a preview queued by a pre-0023 process, or a row
 * whose service is gone).
 *
 * Preview jobs carry the PARENT application's id on their deployment row,
 * so they are told apart by `isPreview`: their outcome lands on
 * `previewDeployments.previewStatus` and never on the production
 * application's status.
 *
 * Called once from the web server's boot sequence, before the queue starts
 * claiming.
 */
export async function recoverInterruptedDeployments(): Promise<RecoveryResult> {
	const interrupted = await db
		.update(deployments)
		.set({
			status: "error",
			errorMessage: INTERRUPTED_MESSAGE,
			finishedAt: new Date(),
		})
		.where(eq(deployments.status, "running"))
		.returning({
			deploymentId: deployments.deploymentId,
			applicationId: deployments.applicationId,
			composeId: deployments.composeId,
			isPreview: deployments.isPreview,
		});

	const applicationIds = [
		...new Set(
			interrupted
				.filter((row) => !row.isPreview)
				.map((row) => row.applicationId)
				.filter((id): id is string => Boolean(id)),
		),
	];
	const composeIds = [
		...new Set(interrupted.map((row) => row.composeId).filter((id): id is string => Boolean(id))),
	];

	await Promise.all([
		applicationIds.length > 0
			? db
					.update(applications)
					.set({ status: "error" })
					.where(inArray(applications.applicationId, applicationIds))
			: Promise.resolve(),
		composeIds.length > 0
			? db.update(compose).set({ status: "error" }).where(inArray(compose.composeId, composeIds))
			: Promise.resolve(),
		// A preview is "running" while its job is in flight — after a restart
		// that job is gone. The exception is a preview whose job is still
		// WAITING: those survive now, so leave them alone instead of flashing
		// "error" until the queue picks the row up again.
		db
			.update(previewDeployments)
			.set({ previewStatus: "error" })
			.where(
				and(
					eq(previewDeployments.previewStatus, "running"),
					notExists(
						db
							.select({ one: sql`1` })
							.from(deployments)
							.where(
								and(
									eq(deployments.previewDeploymentId, previewDeployments.previewDeploymentId),
									eq(deployments.status, "queued"),
								),
							),
					),
				),
			),
	]);

	for (const { deploymentId } of interrupted) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
		publishDeploymentStatusDetached(deploymentId, "error");
	}

	const requeued = await failUnplaceableQueuedRows();
	startQueueLoop();
	return { interrupted: interrupted.length, requeued };
}

/**
 * Fail queued rows the claim query can never place — `app_name IS NULL`, which
 * means either a preview queued by a pre-0023 process (migration 0023 leaves
 * those NULL on purpose: the parent's name would build the production service)
 * or a row whose service is gone. Such a row would otherwise wait forever.
 * Returns how many jobs the loop is about to pick up.
 */
async function failUnplaceableQueuedRows(): Promise<number> {
	const orphans = await db
		.update(deployments)
		.set({
			status: "error",
			errorMessage: "Service no longer exists",
			finishedAt: new Date(),
		})
		.where(and(eq(deployments.status, "queued"), isNull(deployments.appName)))
		.returning({ deploymentId: deployments.deploymentId });

	for (const row of orphans) {
		deploymentEvents.emit("finish", { deploymentId: row.deploymentId, status: "error" });
		publishDeploymentStatusDetached(row.deploymentId, "error");
	}
	return await refreshQueueSnapshot();
}
