import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { previewDeployments } from "../../db/schema";
import { assertApplicationAccess, getOrganizationId } from "../../modules/application";
import {
	createPreviewDeployment,
	deletePreviewDeployment,
	PreviewConflictError,
	PreviewNotFoundError,
	redeployPreviewDeployment,
	withPreviewDomain,
} from "../../modules/preview";
import { upsertPreviewComment } from "../../modules/preview/comment";
import { assertCapability } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Load an application-owned preview deployment and verify org ownership. */
const findApplicationPreview = async (previewDeploymentId: string, organizationId: string) => {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Preview deployment not found" });
	}
	const application = await assertApplicationAccess(preview.applicationId, organizationId);
	return { preview, application };
};

export const previewDeploymentRouter = router({
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			const previews = await db.query.previewDeployments.findMany({
				where: eq(previewDeployments.applicationId, input.applicationId),
				orderBy: desc(previewDeployments.createdAt),
			});
			return Promise.all(previews.map(withPreviewDomain));
		}),

	one: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { preview } = await findApplicationPreview(input.previewDeploymentId, organizationId);
			return withPreviewDomain(preview);
		}),

	/**
	 * Spin up a per-PR variant of an application: `<appName>-pr-<n>` swarm
	 * service routed at `pr-<n>-<appName>.<wildcardDomain>`.
	 */
	create: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1),
				pullRequestNumber: z
					.string()
					.min(1)
					.max(16)
					.regex(/^\d+$/, "pullRequestNumber must be numeric"),
				branch: z.string().nullable().optional(),
				pullRequestId: z.string().nullable().optional(),
				pullRequestTitle: z.string().max(500).nullable().optional(),
				pullRequestURL: z.string().url().nullable().optional(),
				expiresAt: z.date().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			await assertApplicationAccess(input.applicationId, organizationId);

			try {
				return await createPreviewDeployment(input);
			} catch (error) {
				if (error instanceof PreviewConflictError) {
					throw new TRPCError({ code: "CONFLICT", message: error.message });
				}
				if (error instanceof PreviewNotFoundError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				throw error;
			}
		}),

	/** Tear down a preview: remove the variant service, its route and rows. */
	delete: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			await findApplicationPreview(input.previewDeploymentId, organizationId);

			try {
				return await deletePreviewDeployment(input.previewDeploymentId);
			} catch (error) {
				if (error instanceof PreviewNotFoundError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				throw error;
			}
		}),

	/**
	 * Approve a fork-PR preview that is awaiting approval: queues the build
	 * that the webhook gate deferred.
	 */
	approve: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview } = await findApplicationPreview(input.previewDeploymentId, organizationId);
			if (preview.previewStatus !== "awaiting_approval") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Preview is not awaiting approval",
				});
			}
			const result = await redeployPreviewDeployment(preview.previewDeploymentId);
			if (preview.pullRequestNumber) {
				await upsertPreviewComment({
					applicationId: preview.applicationId,
					pullRequestNumber: preview.pullRequestNumber,
					status: "deploying",
				});
			}
			return result;
		}),

	/** Deny a fork-PR preview awaiting approval: tears down row + route, never builds. */
	deny: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview } = await findApplicationPreview(input.previewDeploymentId, organizationId);
			if (preview.previewStatus !== "awaiting_approval") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Preview is not awaiting approval",
				});
			}
			if (preview.pullRequestNumber) {
				await upsertPreviewComment({
					applicationId: preview.applicationId,
					pullRequestNumber: preview.pullRequestNumber,
					status: "removed",
				});
			}
			try {
				return await deletePreviewDeployment(input.previewDeploymentId);
			} catch (error) {
				if (error instanceof PreviewNotFoundError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				throw error;
			}
		}),
});
