import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, previewDeployments } from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import { deploymentEvents } from "./events";
import { getDeploymentLogPath } from "./paths";
import type { DeploymentProvenance, DeploymentTrigger } from "./provenance";
import {
	queuedSiblingsForApp,
	refreshQueueSnapshot,
	rememberJobDetails,
	requestCancellation,
	startQueueLoop,
} from "./queue";
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
	refreshQueueSnapshot,
	setServerConcurrency,
	startQueueLoop,
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
 * Finalize the rows a newer job for the same app just replaced: they never
 * ran, so they end as `cancelled` (not `error` — a push burst must not count
 * as failures in stats, streak alerts or Deploy Copilot).
 *
 * Both statements are guarded on `status = 'queued'`, so a row the worker
 * already claimed (it is `running`) or the user cancelled meanwhile is left
 * alone — that guard is what makes coalescing safe against a concurrent
 * claim. Runs inside `queueDeployment`'s transaction, under an advisory lock
 * on the app name, so two simultaneous pushes cannot supersede each other.
 */
async function supersedeQueuedJobs(
	tx: Pick<typeof db, "execute">,
	target: { appName: string; deploymentId: string; isPreview: boolean },
): Promise<string[]> {
	// Previews build under their own appName but their row names the PARENT
	// application, so SQL cannot derive their coalescing key — the queue's
	// in-process registry supplies the sibling ids instead. (Queued previews
	// never survive a restart, so the registry is always authoritative here.)
	const rows = target.isPreview
		? await (async () => {
				const ids = queuedSiblingsForApp(target.appName, target.deploymentId);
				if (ids.length === 0) return [];
				return (await tx.execute(sql`
					update "deployment"
					set "status" = 'cancelled', "error_message" = ${SUPERSEDED_MESSAGE}, "finished_at" = now()
					where "status" = 'queued' and "deployment_id" = any(${sql.param(ids)}::text[])
					returning "deployment_id"
				`)) as unknown as { deployment_id: string }[];
			})()
		: ((await tx.execute(sql`
				update "deployment" d
				set "status" = 'cancelled', "error_message" = ${SUPERSEDED_MESSAGE}, "finished_at" = now()
				from (
					select q."deployment_id"
					from "deployment" q
					left join "application" a on a."application_id" = q."application_id"
					left join "compose" c on c."compose_id" = q."compose_id"
					where q."status" = 'queued'
						and q."is_preview" = false
						and q."deployment_id" <> ${target.deploymentId}
						and coalesce(a."app_name", c."app_name") = ${target.appName}
				) s
				where d."deployment_id" = s."deployment_id"
				returning d."deployment_id"
			`)) as unknown as { deployment_id: string }[]);

	return rows.map((row) => row.deployment_id);
}

/**
 * Create a deployment row (`queued`). The worker loop claims it straight from
 * Postgres (FIFO per target server, one job per app at a time) — nothing is
 * handed over in memory, so a restart between this insert and the build keeps
 * the job. A row still waiting for the same app is superseded in the same
 * transaction: the burst of pushes that used to queue N full builds leaves at
 * most one queued + one running job per app.
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
	const isPreview = Boolean(job.previewDeploymentId);

	const superseded = await db.transaction(async (tx) => {
		// Serialize concurrent enqueues for ONE app so two pushes landing in
		// the same millisecond cannot each insert a queued row and then find
		// nothing to supersede. Different apps never contend.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${appName}))`);
		await tx.insert(deployments).values({
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
			// The worker's claim query flips this to "running"; rows still
			// "queued" after a restart are claimed by the next boot's loop.
			status: "queued",
			logPath: getDeploymentLogPath(appName, deploymentId),
			applicationId: job.applicationId ?? null,
			composeId: job.composeId ?? null,
			isPreview,
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
		return await supersedeQueuedJobs(tx, { appName, deploymentId, isPreview });
	});

	// Registered only once the row is committed: the claim loop's snapshot GC
	// drops registry entries for deployments it cannot see as queued/running.
	// The row does not carry the preview id or the preview's own appName —
	// this is where the claim loop finds them (see queue.ts).
	rememberJobDetails(deploymentId, {
		appName,
		previewDeploymentId: job.previewDeploymentId,
		type: job.type,
	});

	for (const id of superseded) {
		deploymentEvents.emit("finish", { deploymentId: id, status: "cancelled" });
	}
	startQueueLoop();
	deploymentEvents.emit("enqueued", { deploymentId, serverId });
	// So the caller's very next `deployment.byApplication` already renders
	// "Queued (#n)" instead of waiting for the loop's own refresh.
	await refreshQueueSnapshot().catch(() => {});
	return deploymentId;
}

/**
 * Cancel a deployment. A row that is still `queued` is finalized with a
 * conditional UPDATE — the same `status = 'queued'` guard the claim query
 * uses, so exactly one of "cancelled" and "claimed" can win. A row the worker
 * is already building has its child processes killed and is finalized by the
 * worker.
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

	const dequeued = await db
		.update(deployments)
		.set({ status: "cancelled", finishedAt: new Date() })
		.where(and(eq(deployments.deploymentId, deploymentId), eq(deployments.status, "queued")))
		.returning({ deploymentId: deployments.deploymentId });
	if (dequeued.length > 0) {
		deploymentEvents.emit("finish", { deploymentId, status: "cancelled" });
		return;
	}

	// Running: the worker observes the cancellation, finalizes the row and
	// emits "finish" itself.
	if (requestCancellation(deploymentId) === "running") return;

	// `running` in the database but not in this process (a row left over by a
	// crash the boot recovery has not reached yet): finalize directly so the
	// UI does not show a zombie deployment.
	await db
		.update(deployments)
		.set({ status: "cancelled", finishedAt: new Date() })
		.where(and(eq(deployments.deploymentId, deploymentId), eq(deployments.status, "running")))
		.returning({ deploymentId: deployments.deploymentId });
	deploymentEvents.emit("finish", { deploymentId, status: "cancelled" });
}
