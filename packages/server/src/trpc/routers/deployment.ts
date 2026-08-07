import { readFile } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import {
	getDeploymentDailyCounts,
	getDeploymentStatsByProject,
	listDeploymentsByApplication,
	listDeploymentsByCompose,
	listDeploymentsByProject,
	listRecentDeployments,
} from "../../modules/deployment/queries";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const limitInput = z.number().int().min(1).max(100);

const pagedInput = {
	limit: limitInput.default(20),
	cursor: z.string().nullish(),
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
			return listDeploymentsByProject(input.projectId, organizationId, {
				limit: input.limit,
				cursor: input.cursor,
			});
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
			return listDeploymentsByApplication(input.applicationId, organizationId, {
				limit: input.limit,
				cursor: input.cursor,
			});
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
			return listDeploymentsByCompose(input.composeId, organizationId, {
				limit: input.limit,
				cursor: input.cursor,
			});
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
			return listRecentDeployments(organizationId, {
				limit: input.limit,
				cursor: input.cursor,
			});
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

	/** Read a deployment's on-disk build log (CLI / tooling). */
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
			if (!deployment.logPath) {
				return {
					deploymentId,
					status: deployment.status,
					log: "",
					offset: 0,
					done: deployment.status !== "running",
				};
			}

			let content = "";
			try {
				content = await readFile(deployment.logPath, "utf8");
			} catch {
				content = "";
			}
			const offset = input.offset ?? 0;
			const slice = content.slice(offset);
			return {
				deploymentId,
				status: deployment.status,
				log: slice,
				offset: content.length,
				done: deployment.status !== "running",
			};
		}),
});
