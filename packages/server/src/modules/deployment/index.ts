import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import { deploymentEvents } from "./events";
import { getDeploymentLogPath } from "./paths";
import type { DeploymentProvenance, DeploymentTrigger } from "./provenance";
import { enqueue, type QueueJob, requestCancellation } from "./queue";
// Importing the worker registers its job runner with the queue (side effect).
import "./worker";

export { dockerCleanup } from "./cleanup";
export type { DeploymentFinishEvent, DeploymentLogEvent, DeploymentStatus } from "./events";
export { deploymentEvents } from "./events";
export {
	applicationReadiness,
	composeReadiness,
	type DeploymentProvenance,
	type DeploymentTrigger,
	type DeployReadiness,
	firstLine,
	isApiKeySession,
	provenanceForSession,
	SOURCE_NOT_CONFIGURED,
} from "./provenance";
export {
	drainQueue,
	getQueuePosition,
	isQueueDraining,
	queueDepth,
	setServerConcurrency,
} from "./queue";

export interface DeploymentJobInput extends Partial<DeploymentProvenance> {
	applicationId?: string;
	composeId?: string;
	previewDeploymentId?: string;
	type: "deploy" | "redeploy";
	/** Row title; defaults to "Deployment" / "Redeploy" (previews prefixed). */
	title?: string;
}

/**
 * Trigger recorded when a caller does not say: a plain redeploy (Deploy
 * Copilot "apply & redeploy", template re-runs) is `redeploy`, a first
 * deploy is `manual`. Every router/webhook/cron caller passes its own.
 */
export function defaultTrigger(type: DeploymentJobInput["type"]): DeploymentTrigger {
	return type === "redeploy" ? "redeploy" : "manual";
}

/** Error message stored on a queued row replaced by a newer job for the same app. */
export const SUPERSEDED_MESSAGE = "Superseded by a newer deployment";

/**
 * Finalize rows whose in-memory job was dropped by queue coalescing: they
 * never ran, so they end as `cancelled` (not `error` — a push burst must not
 * count as failures in stats, streak alerts or Deploy Copilot). Guarded on
 * `status = queued` so a row the user cancelled meanwhile is left alone.
 */
export async function markSuperseded(jobs: QueueJob[]): Promise<void> {
	if (jobs.length === 0) return;
	const ids = jobs.map((job) => job.deploymentId);
	const rows = await db
		.update(deployments)
		.set({ status: "cancelled", errorMessage: SUPERSEDED_MESSAGE, finishedAt: new Date() })
		.where(and(inArray(deployments.deploymentId, ids), eq(deployments.status, "queued")))
		.returning({ deploymentId: deployments.deploymentId });
	for (const row of rows) {
		deploymentEvents.emit("finish", { deploymentId: row.deploymentId, status: "cancelled" });
	}
}

/**
 * Create a deployment row (`queued`) and enqueue the job (FIFO per target
 * server, one job per app at a time). A job still waiting for the same app
 * is superseded: the burst of pushes that used to queue N full builds now
 * leaves at most one queued + one running job per app.
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
		title:
			job.title ??
			(job.previewDeploymentId
				? job.type === "redeploy"
					? "Preview redeploy"
					: "Preview deployment"
				: job.type === "redeploy"
					? "Redeploy"
					: "Deployment"),
		// The worker flips this to "running" when it picks the job up; rows
		// still "queued" at boot are re-enqueued by recovery.ts.
		status: "queued",
		logPath: getDeploymentLogPath(appName, deploymentId),
		applicationId: job.applicationId ?? null,
		composeId: job.composeId ?? null,
		isPreview: Boolean(job.previewDeploymentId),
		serverId,
		// Provenance: who started it and, when the caller already knows (webhook
		// payloads), which commit. Git clones fill the commit fields later
		// (worker → readCheckoutCommit) when they are still null.
		trigger: job.trigger ?? defaultTrigger(job.type),
		triggeredBy: job.triggeredBy ?? null,
		commitSha: job.commitSha ?? null,
		commitMessage: job.commitMessage ?? null,
		commitAuthor: job.commitAuthor ?? null,
	});

	// enqueue() coalesces synchronously, so two concurrent calls for one app
	// cannot both slip a pending job past each other.
	const { superseded } = enqueue({
		deploymentId,
		appName,
		applicationId: job.applicationId,
		composeId: job.composeId,
		previewDeploymentId: job.previewDeploymentId,
		type: job.type,
		serverId,
	});
	await markSuperseded(superseded);
	return deploymentId;
}

/**
 * Cancel a deployment. Queued jobs are dequeued and finalized immediately;
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
	if (deployment.status !== "running" && deployment.status !== "queued") {
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
