import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import { deploymentEvents } from "./events";
import { getDeploymentLogPath } from "./paths";
import { enqueue, requestCancellation } from "./queue";
// Importing the worker registers its job runner with the queue (side effect).
import "./worker";

export { dockerCleanup } from "./cleanup";
export type { DeploymentFinishEvent, DeploymentStatus } from "./events";
export { deploymentEvents } from "./events";
export { queueDepth, setServerConcurrency } from "./queue";

export interface DeploymentJobInput {
	applicationId?: string;
	composeId?: string;
	previewDeploymentId?: string;
	type: "deploy" | "redeploy";
}

/**
 * Create a deployment row and enqueue the job (FIFO per target server).
 * Returns the deploymentId — the WS layer streams the log from disk and
 * closes on the matching {@link deploymentEvents} `finish` (or DB status).
 */
export async function queueDeployment(job: DeploymentJobInput): Promise<string> {
	if (!job.applicationId && !job.composeId) {
		throw new Error("queueDeployment requires an applicationId or composeId");
	}

	let appName: string;
	let serverId: string | null;
	if (job.previewDeploymentId) {
		const preview = await db.query.previewDeployments.findFirst({
			where: eq(previewDeployments.previewDeploymentId, job.previewDeploymentId),
		});
		if (!preview) throw new Error(`Preview deployment not found: ${job.previewDeploymentId}`);
		appName = preview.appName;
		serverId = preview.serverId;
		if (job.applicationId && job.applicationId !== preview.applicationId) {
			throw new Error("previewDeploymentId does not match applicationId");
		}
		job.applicationId = preview.applicationId;
	} else if (job.applicationId) {
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
		title: job.previewDeploymentId
			? job.type === "redeploy"
				? "Preview redeploy"
				: "Preview deployment"
			: job.type === "redeploy"
				? "Redeploy"
				: "Deployment",
		// NOTE: the deploymentStatus enum has no "pending" value; a queued
		// job is stored as "running" until the worker finalizes it.
		status: "running",
		logPath: getDeploymentLogPath(appName, deploymentId),
		applicationId: job.applicationId ?? null,
		composeId: job.composeId ?? null,
		isPreview: Boolean(job.previewDeploymentId),
		serverId,
	});

	enqueue({
		deploymentId,
		applicationId: job.applicationId,
		composeId: job.composeId,
		previewDeploymentId: job.previewDeploymentId,
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
