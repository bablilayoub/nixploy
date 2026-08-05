import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
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
		.returning({ deploymentId: deployments.deploymentId });

	for (const { deploymentId } of interrupted) {
		deploymentEvents.emit("finish", { deploymentId, status: "error" });
	}
	return interrupted.length;
}
