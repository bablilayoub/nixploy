import { open, stat } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { deploymentStatus } from "../../db/schema/enums";
import { getQueuePosition } from "../../modules/deployment";
import {
	buildDeploymentOutcome,
	DEFAULT_LOG_LINES,
	MAX_LOG_LINES,
	MAX_WAIT_MS,
	waitForDeployment,
} from "../../modules/deployment/outcome";
import {
	type DeploymentListResult,
	getDeploymentDailyCounts,
	getDeploymentStatsByProject,
	listDeploymentsByApplication,
	listDeploymentsByCompose,
	listDeploymentsByProject,
	listRecentDeployments,
} from "../../modules/deployment/queries";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const isActive = (status: string): boolean => status === "running" || status === "queued";

/**
 * Decorate a page with each queued row's 1-based place in its server's line
 * (`null` for anything not waiting). Cheap: a Map lookup in the in-memory
 * queue, no extra query.
 */
function withQueuePositions(page: DeploymentListResult) {
	return {
		...page,
		deployments: page.deployments.map((deployment) => ({
			...deployment,
			queuePosition:
				deployment.status === "queued" ? getQueuePosition(deployment.deploymentId) : null,
		})),
	};
}

/**
 * Read a log file from a byte offset without loading what the caller already
 * has. Returns the new text and the offset to resume from (the file size).
 */
async function readLogFrom(
	logPath: string,
	offset: number,
): Promise<{ log: string; offset: number }> {
	let size: number;
	try {
		size = (await stat(logPath)).size;
	} catch {
		return { log: "", offset: 0 };
	}
	// A rewritten (shorter) file: restart from the top rather than skip bytes.
	const from = offset > size ? 0 : offset;
	if (size <= from) return { log: "", offset: size };
	const handle = await open(logPath, "r");
	try {
		const buffer = Buffer.allocUnsafe(size - from);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
		return { log: buffer.subarray(0, bytesRead).toString("utf8"), offset: from + bytesRead };
	} finally {
		await handle.close();
	}
}

const limitInput = z.number().int().min(1).max(100);

const pagedInput = {
	limit: limitInput.default(20),
	cursor: z.string().nullish(),
	/**
	 * Keep only these statuses. Filtering happens in SQL because the feed is
	 * keyset-paginated: a page filtered after it arrives is still counted as a
	 * page, so "the last 20" would arrive with four rows in it.
	 */
	status: z.array(z.enum(deploymentStatus.enumValues)).max(8).optional(),
};

async function assertDeploymentAccess(deploymentId: string, organizationId: string) {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	if (!deployment) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
	}
	const orgId =
		deployment.application?.environment.project.organizationId ??
		deployment.compose?.environment.project.organizationId;
	if (orgId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
	}
	return deployment;
}

/**
 * Organization-wide deployments overview. Read-only; cancellation lives on
 * `application.cancelDeployment` (not duplicated here).
 */
export const deploymentRouter = router({
	/** Per-day deployment counts for the last N days (dashboard chart). */
	daily: protectedProcedure
		.input(z.object({ days: z.number().int().min(1).max(90).default(14) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return await getDeploymentDailyCounts(organizationId, input.days);
		}),

	/** Deployments of every service in a project, newest first (keyset-paginated). */
	byProject: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				...pagedInput,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return withQueuePositions(
				await listDeploymentsByProject(input.projectId, organizationId, {
					limit: input.limit,
					cursor: input.cursor,
					status: input.status,
				}),
			);
		}),

	/** Deployments of one application, newest first. */
	byApplication: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1),
				...pagedInput,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return withQueuePositions(
				await listDeploymentsByApplication(input.applicationId, organizationId, {
					limit: input.limit,
					cursor: input.cursor,
					status: input.status,
				}),
			);
		}),

	/** Deployments of one compose service, newest first. */
	byCompose: protectedProcedure
		.input(
			z.object({
				composeId: z.string().min(1),
				...pagedInput,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return withQueuePositions(
				await listDeploymentsByCompose(input.composeId, organizationId, {
					limit: input.limit,
					cursor: input.cursor,
					status: input.status,
				}),
			);
		}),

	/** Most recent deployments across the caller's whole organization. */
	recent: protectedProcedure
		.input(
			z.object({
				...pagedInput,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return withQueuePositions(
				await listRecentDeployments(organizationId, {
					limit: input.limit,
					cursor: input.cursor,
				}),
			);
		}),

	/** Deployment counts by status for a project (dashboard widget). */
	statsByProject: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return getDeploymentStatsByProject(input.projectId, organizationId);
		}),

	/**
	 * The machine-readable verdict on a deployment: status, the step it died
	 * in, the log tail, the URLs it should answer on, and whether Swarm has
	 * tasks running (`modules/deployment/outcome.ts`).
	 *
	 * `waitMs` turns it into a long poll: it returns as soon as the deployment
	 * reaches a terminal state, or when the wait runs out — in which case
	 * `done` is simply still false and the caller can ask again. Capped at 55 s
	 * because a proxy or a browser gives up past that anyway.
	 */
	wait: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				waitMs: z.number().int().min(0).max(MAX_WAIT_MS).default(0),
				logLines: z.number().int().min(0).max(MAX_LOG_LINES).default(DEFAULT_LOG_LINES),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			// Authorise BEFORE waiting: a caller who cannot see this deployment
			// must not be able to hold a request open on it, or to learn that it
			// exists from how long the call takes.
			const deployment = await assertDeploymentAccess(input.deploymentId, organizationId);
			if (input.waitMs > 0) {
				await waitForDeployment(input.deploymentId, input.waitMs);
			}
			// Re-read through the access helper so the outcome is built from the
			// row as it is now, with its parents joined.
			const settled = await assertDeploymentAccess(input.deploymentId, organizationId);
			return buildDeploymentOutcome(settled ?? deployment, { logLines: input.logLines });
		}),

	/**
	 * Read a deployment's on-disk build log (CLI / tooling). `offset` is the
	 * byte offset returned by the previous call; only the bytes appended since
	 * are read and returned.
	 */
	getLogs: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1).optional(),
				applicationId: z.string().min(1).optional(),
				composeId: z.string().min(1).optional(),
				offset: z.number().int().min(0).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);

			let deploymentId = input.deploymentId;
			if (!deploymentId && input.applicationId) {
				const page = await listDeploymentsByApplication(input.applicationId, organizationId, {
					limit: 1,
				});
				deploymentId = page.deployments[0]?.deploymentId;
			}
			if (!deploymentId && input.composeId) {
				const page = await listDeploymentsByCompose(input.composeId, organizationId, {
					limit: 1,
				});
				deploymentId = page.deployments[0]?.deploymentId;
			}
			if (!deploymentId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "No deployment found" });
			}

			const deployment = await assertDeploymentAccess(deploymentId, organizationId);
			const queuePosition =
				deployment.status === "queued" ? getQueuePosition(deployment.deploymentId) : null;
			if (!deployment.logPath) {
				return {
					deploymentId,
					status: deployment.status,
					log: "",
					offset: 0,
					done: !isActive(deployment.status),
					queuePosition,
				};
			}

			const { log, offset } = await readLogFrom(deployment.logPath, input.offset ?? 0);
			return {
				deploymentId,
				status: deployment.status,
				log,
				offset,
				done: !isActive(deployment.status),
				queuePosition,
			};
		}),
});
