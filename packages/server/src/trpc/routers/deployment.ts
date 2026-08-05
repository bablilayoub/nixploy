import { z } from "zod";
import {
	getDeploymentDailyCounts,
	getDeploymentStatsByProject,
	listDeploymentsByApplication,
	listDeploymentsByCompose,
	listDeploymentsByProject,
	listRecentDeployments,
} from "../../modules/deployments";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const limitInput = z.number().int().min(1).max(100);

const pagedInput = {
	limit: limitInput.default(20),
	cursor: z.string().nullish(),
};

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
});
