import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments } from "../../db/schema";
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
		});

	const applicationIds = [
		...new Set(
			interrupted.map((row) => row.applicationId).filter((id): id is string => Boolean(id)),
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
	]);

	for (const { deploymentId } of interrupted) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
	}
	return interrupted.length;
}
