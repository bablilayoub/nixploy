import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments } from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import { deploymentEvents } from "./events";
import { getDeploymentLogPath } from "./paths";
import { enqueue, requestCancellation } from "./queue";
// Importing the worker registers its job runner with the queue (side effect).
import "./worker";

export { dockerCleanup } from "./cleanup";
export type { DeploymentFinishEvent, DeploymentLogEvent, DeploymentStatus } from "./events";
export { deploymentEvents } from "./events";
export { queueDepth, setServerConcurrency } from "./queue";

export interface DeploymentJobInput {
	applicationId?: string;
	composeId?: string;
	type: "deploy" | "redeploy";
}

/**
 * Create a deployment row and enqueue the job (FIFO per target server).
 * Returns the deploymentId — the WS layer streams its log from
 * {@link deploymentEvents} and the row is finalized by the worker.
 */
export async function queueDeployment(job: DeploymentJobInput): Promise<string> {
	if (!job.applicationId && !job.composeId) {
		throw new Error("queueDeployment requires an applicationId or composeId");
	}

	let appName: string;
	let serverId: string | null;
	if (job.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, job.applicationId),
		});
		if (!application) throw new Error(`Application not found: ${job.applicationId}`);
		appName = application.appName;
		serverId = application.serverId;
	} else {
		const composeRow = await db.query.compose.findFirst({
			where: eq(compose.composeId, job.composeId ?? ""),
		});
		if (!composeRow) throw new Error(`Compose service not found: ${job.composeId}`);
		appName = composeRow.appName;
		serverId = composeRow.serverId;
	}

	const deploymentId = generateId();
	await db.insert(deployments).values({
		deploymentId,
		title: job.type === "redeploy" ? "Redeploy" : "Deployment",
		// NOTE: the deploymentStatus enum has no "pending" value; a queued
		// job is stored as "running" until the worker finalizes it.
		status: "running",
		logPath: getDeploymentLogPath(appName, deploymentId),
		applicationId: job.applicationId ?? null,
		composeId: job.composeId ?? null,
		serverId,
	});

	enqueue({
		deploymentId,
		applicationId: job.applicationId,
		composeId: job.composeId,
		type: job.type,
		serverId,
	});
	return deploymentId;
}

/**
 * Cancel a deployment. Pending jobs are dequeued and finalized immediately;
 * running jobs have their child processes killed and the worker finalizes
 * the row as "cancelled".
 */
export async function cancelDeployment(deploymentId: string): Promise<void> {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
	});
	if (!deployment) {
		throw new Error(`Deployment not found: ${deploymentId}`);
	}
	if (deployment.status !== "running") {
		return; // already in a terminal state
	}

	const found = requestCancellation(deploymentId);
	if (found === "pending") {
		await db
			.update(deployments)
			.set({ status: "cancelled", finishedAt: new Date() })
			.where(eq(deployments.deploymentId, deploymentId));
		deploymentEvents.emit("finish", { deploymentId, status: "cancelled" });
		return;
	}
	if (found === null) {
		// Not in this process's queue (restarted server, stale row): finalize
		// directly so the UI does not show a zombie "running" deployment.
		await db
			.update(deployments)
			.set({ status: "cancelled", finishedAt: new Date() })
			.where(eq(deployments.deploymentId, deploymentId));
		deploymentEvents.emit("finish", { deploymentId, status: "cancelled" });
	}
	// found === "running": the worker observes the cancellation, finalizes
	// the row and emits "finish" itself.
}
