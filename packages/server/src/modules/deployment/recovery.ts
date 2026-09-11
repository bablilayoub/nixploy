import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { deploymentEvents } from "./events";
import { refreshQueueSnapshot, startQueueLoop } from "./queue";

const INTERRUPTED_MESSAGE = "Interrupted: Nixploy restarted while this deployment was in flight";

export interface RecoveryResult {
	/** Rows that were `running` (or queued previews) and had to be failed. */
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
 * shutdown leaves them `queued` on purpose — see `queue.ts#drainQueue`.) The
 * one exception is queued *preview* jobs: the deployment row carries neither
 * the previewDeploymentId nor the preview's appName, so the job cannot be
 * rebuilt from the row and is failed instead.
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

	// Queued previews cannot be claimed (the row carries neither the preview
	// id nor the preview appName).
	const interruptedPreviews = await db
		.update(deployments)
		.set({
			status: "error",
			errorMessage: INTERRUPTED_MESSAGE,
			finishedAt: new Date(),
		})
		.where(and(eq(deployments.status, "queued"), eq(deployments.isPreview, true)))
		.returning({ deploymentId: deployments.deploymentId });

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
		// A preview can only be "running" while its job is in flight — after a
		// restart every one of them was interrupted.
		db
			.update(previewDeployments)
			.set({ previewStatus: "error" })
			.where(eq(previewDeployments.previewStatus, "running")),
	]);

	for (const { deploymentId } of [...interrupted, ...interruptedPreviews]) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
	}

	const requeued = await failOrphanedQueuedRows();
	startQueueLoop();
	return { interrupted: interrupted.length + interruptedPreviews.length, requeued };
}

/**
 * Fail queued rows whose service no longer exists (the FK cascade should
 * prevent it, but such a row would be invisible to the claim query forever)
 * and report how many jobs the loop is about to pick up.
 */
async function failOrphanedQueuedRows(): Promise<number> {
	const orphans = (await db.execute(sql`
		update "deployment" d
		set "status" = 'error', "error_message" = 'Service no longer exists', "finished_at" = now()
		from (
			select q."deployment_id"
			from "deployment" q
			left join "application" a on a."application_id" = q."application_id"
			left join "compose" c on c."compose_id" = q."compose_id"
			where q."status" = 'queued' and coalesce(a."app_name", c."app_name") is null
		) s
		where d."deployment_id" = s."deployment_id"
		returning d."deployment_id"
	`)) as unknown as { deployment_id: string }[];

	for (const row of orphans) {
		deploymentEvents.emit("finish", { deploymentId: row.deployment_id, status: "error" });
	}
	return await refreshQueueSnapshot();
}
