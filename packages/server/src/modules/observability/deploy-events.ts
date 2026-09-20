import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { resolveDeploymentOwner } from "../deployment/notify";
import type { ServiceEventKind } from "./event-kinds";
import { recordServiceEvent } from "./service-events";

const log = createLogger("service-events");

/**
 * Deployment transitions as timeline rows.
 *
 * The deployment history already lists every build; what it cannot say is how
 * a deploy sits next to the task that died four minutes later. Putting both on
 * one timeline is the point of the feature, so each transition writes a row
 * here as well as a `deployment` frame.
 *
 * Lives apart from `service-events.ts` so the write path stays free of the
 * deployment tables — the reconciler imports that file on every pass.
 */

const TERMINAL_KINDS = {
	done: "deploy_finished",
	error: "deploy_failed",
	cancelled: "deploy_cancelled",
} as const satisfies Record<string, ServiceEventKind>;

export type TerminalDeploymentStatus = keyof typeof TERMINAL_KINDS;

/** Short, stable label for a deployment in a timeline row. */
const deploymentLabel = (deploymentId: string): string => `#${deploymentId.slice(0, 8)}`;

interface DeploymentEventOptions {
	/** Overrides the default copy for the kind. */
	title?: string;
	message?: string | null;
	metadata?: Record<string, unknown>;
	/** Who asked for it, when a human did. */
	actorId?: string | null;
	actorEmail?: string | null;
}

/**
 * Write one timeline row for a deployment, resolving the service and the
 * organization from the deployment row itself.
 *
 * Preview deploys are recorded on the **parent** service — that is where
 * someone looks when a preview URL is broken — tagged `preview: true` in the
 * metadata so the panel can tell them apart.
 *
 * Never throws: a timeline write must not fail a deploy.
 */
export async function recordDeploymentEvent(
	deploymentId: string,
	kind: ServiceEventKind,
	options: DeploymentEventOptions = {},
): Promise<void> {
	try {
		const owner = await resolveDeploymentOwner(deploymentId);
		if (!owner) return;
		const serviceId = owner.applicationId ?? owner.composeId;
		if (!serviceId) return;
		await recordServiceEvent({
			organizationId: owner.organizationId,
			serviceType: owner.applicationId ? "application" : "compose",
			serviceId,
			appName: owner.appName ?? "",
			kind,
			title: options.title ?? defaultTitle(kind, deploymentId, owner.isPreview),
			message: options.message ?? null,
			deploymentId,
			actorId: options.actorId ?? null,
			actorEmail: options.actorEmail ?? null,
			// One row per (deployment, kind): the worker finalizes once, but boot
			// recovery can finalize a row a crashed worker left behind, and two
			// "deploy failed" rows for one deploy would read as two failures.
			dedupeKey: `deployment:${deploymentId}:${kind}`,
			metadata: {
				...(options.metadata ?? {}),
				...(owner.isPreview ? { preview: true } : {}),
			},
		});
	} catch (error) {
		log.debug("Failed to record a deployment timeline event", {
			deploymentId,
			kind,
			error: describeErrorWithCause(error),
		});
	}
}

function defaultTitle(kind: ServiceEventKind, deploymentId: string, isPreview: boolean): string {
	const label = `${isPreview ? "Preview deploy" : "Deploy"} ${deploymentLabel(deploymentId)}`;
	switch (kind) {
		case "deploy_started":
			return `${label} started`;
		case "deploy_finished":
			return `${label} finished`;
		case "deploy_failed":
			return `${label} failed`;
		case "deploy_cancelled":
			return `${label} cancelled`;
		default:
			return label;
	}
}

/**
 * The terminal transition of a deployment. Reads the row's own
 * `errorMessage` so a failure row carries the reason, not just the verdict.
 */
export async function recordDeploymentOutcomeEvent(
	deploymentId: string,
	status: TerminalDeploymentStatus,
	errorMessage: string | null,
): Promise<void> {
	const row = await db.query.deployments
		.findFirst({
			where: eq(deployments.deploymentId, deploymentId),
			columns: { title: true, requestedRef: true, commitSha: true },
		})
		.catch(() => undefined);
	await recordDeploymentEvent(deploymentId, TERMINAL_KINDS[status], {
		message: errorMessage,
		metadata: {
			...(row?.title ? { deployTitle: row.title } : {}),
			...(row?.requestedRef ? { ref: row.requestedRef } : {}),
			...(row?.commitSha ? { commitSha: row.commitSha } : {}),
		},
	});
}
