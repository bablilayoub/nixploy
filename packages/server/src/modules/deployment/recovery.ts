import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { deploymentEvents } from "./events";

/**
 * Fail every deployment still marked "running" at boot.
 *
 * The deploy queue lives in memory, so a restart (deploy of Nixploy itself,
 * crash, host reboot) abandons whatever was queued or building. The rows would
 * stay "running" forever, which is not just cosmetic: the status reconciler
 * skips any service that has a running deployment, so one zombie row freezes
 * status corrections for that service indefinitely.
 *
 * Preview jobs carry the PARENT application's id on their deployment row
 * (there is no previewDeploymentId column), so they are told apart by
 * `isPreview`: their outcome lands on `previewDeployments.previewStatus`
 * and never on the production application's status.
 *
 * Called once from the web server's boot sequence, before the queue accepts
 * new jobs.
 */
export async function recoverInterruptedDeployments(): Promise<number> {
	const interrupted = await db
		.update(deployments)
		.set({
			status: "error",
			errorMessage: "Interrupted: Nixploy restarted while this deployment was in flight",
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
		// A preview can only be "running" while its job sits in the in-memory
		// queue — after a restart every one of them was interrupted.
		db
			.update(previewDeployments)
			.set({ previewStatus: "error" })
			.where(eq(previewDeployments.previewStatus, "running")),
	]);

	for (const { deploymentId } of interrupted) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
	}
	return interrupted.length;
}
