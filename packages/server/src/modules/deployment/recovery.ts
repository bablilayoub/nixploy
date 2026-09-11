import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { deploymentEvents } from "./events";
import { markSuperseded } from "./index";
import { enqueue } from "./queue";

const INTERRUPTED_MESSAGE = "Interrupted: Nixploy restarted while this deployment was in flight";

export interface RecoveryResult {
	/** Rows that were `running` (or queued previews) and had to be failed. */
	interrupted: number;
	/** `queued` rows put back on the in-memory queue, oldest first. */
	requeued: number;
}

/**
 * Boot-time repair of the deployment table.
 *
 * The deploy queue lives in memory, so a restart (deploy of Nixploy itself,
 * crash, host reboot) abandons whatever was building. Those `running` rows
 * would stay `running` forever, which is not just cosmetic: the status
 * reconciler skips any service that has a running deployment, so one zombie
 * row freezes status corrections for that service indefinitely — they are
 * failed here.
 *
 * `queued` rows never started, so nothing was lost: they are re-enqueued in
 * creation order and the backlog survives the restart. (Graceful shutdown
 * leaves them `queued` on purpose — see `queue.ts#drainQueue`.) The one
 * exception is queued *preview* jobs: the deployment row does not carry the
 * previewDeploymentId, so the job cannot be rebuilt and is failed instead.
 *
 * Preview jobs carry the PARENT application's id on their deployment row,
 * so they are told apart by `isPreview`: their outcome lands on
 * `previewDeployments.previewStatus` and never on the production
 * application's status.
 *
 * Called once from the web server's boot sequence, before the queue accepts
 * new jobs.
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

	// Queued previews cannot be re-enqueued (no previewDeploymentId on the row).
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
		// A preview can only be "running" while its job sits in the in-memory
		// queue — after a restart every one of them was interrupted.
		db
			.update(previewDeployments)
			.set({ previewStatus: "error" })
			.where(eq(previewDeployments.previewStatus, "running")),
	]);

	for (const { deploymentId } of [...interrupted, ...interruptedPreviews]) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
	}

	const requeued = await requeuePendingDeployments();
	return { interrupted: interrupted.length + interruptedPreviews.length, requeued };
}

/** Put every non-preview `queued` row back on the queue, oldest first. */
async function requeuePendingDeployments(): Promise<number> {
	const queued = await db.query.deployments.findMany({
		where: and(eq(deployments.status, "queued"), eq(deployments.isPreview, false)),
		orderBy: [asc(deployments.createdAt), asc(deployments.deploymentId)],
		with: {
			application: { columns: { appName: true, serverId: true } },
			compose: { columns: { appName: true, serverId: true } },
		},
	});

	let requeued = 0;
	for (const row of queued) {
		const target = row.application ?? row.compose;
		if (!target) {
			// Service deleted underneath the row (FK cascade should prevent this).
			await db
				.update(deployments)
				.set({ status: "error", errorMessage: "Service no longer exists", finishedAt: new Date() })
				.where(eq(deployments.deploymentId, row.deploymentId));
			deploymentEvents.emit("finish", { deploymentId: row.deploymentId, status: "error" });
			continue;
		}
		const { superseded } = enqueue({
			deploymentId: row.deploymentId,
			appName: target.appName,
			applicationId: row.applicationId ?? undefined,
			composeId: row.composeId ?? undefined,
			type: row.title === "Redeploy" ? "redeploy" : "deploy",
			serverId: target.serverId,
		});
		requeued += 1;
		// Two queued rows for one app (crash between insert and supersede):
		// the newer one wins, exactly as it would have at enqueue time.
		await markSuperseded(superseded);
		requeued -= superseded.length;
	}
	return requeued;
}
