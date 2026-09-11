import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { previewDeployments } from "../../db/schema";
import { assertApplicationAccess, getOrganizationId } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { findComposeForOrg } from "../../modules/compose/service";
import {
	createPreviewDeployment,
	deletePreviewDeployment,
	PreviewConflictError,
	PreviewLimitError,
	PreviewNotFoundError,
	type PreviewParentRef,
	previewParentRef,
	redeployPreviewDeployment,
	withPreviewDomain,
} from "../../modules/preview";
import { upsertPreviewComment } from "../../modules/preview/comment";
import { assertCapability } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** A preview hangs off exactly one parent; every input names it the same way. */
const parentInput = z
	.object({
		applicationId: z.string().min(1).optional(),
		composeId: z.string().min(1).optional(),
	})
	.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
		message: "Exactly one of applicationId or composeId is required",
	});

/** Resolve + org-check the parent a preview input names. */
async function assertPreviewParentAccess(
	ref: PreviewParentRef,
	organizationId: string,
): Promise<{ kind: "application" | "compose"; id: string }> {
	const target = previewParentRef(ref);
	if (!target) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Exactly one of applicationId or composeId is required",
		});
	}
	if (target.kind === "application") {
		await assertApplicationAccess(target.id, organizationId);
	} else {
		await findComposeForOrg(target.id, organizationId);
	}
	return target;
}

/** Load a preview and verify its parent belongs to the organization. */
const findPreview = async (previewDeploymentId: string, organizationId: string) => {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Preview deployment not found" });
	}
	const parent = await assertPreviewParentAccess(
		{ applicationId: preview.applicationId, composeId: preview.composeId },
		organizationId,
	);
	return { preview, parent };
};

/** Audit targets mirror the parent kind so the log reads like every other row. */
const auditTarget = (parent: { kind: "application" | "compose"; id: string }) => ({
	targetType: parent.kind,
	targetId: parent.id,
});

export const previewDeploymentRouter = router({
	/** Previews of one application or one compose service. */
	list: protectedProcedure.input(parentInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const parent = await assertPreviewParentAccess(input, organizationId);
		const previews = await db.query.previewDeployments.findMany({
			where:
				parent.kind === "application"
					? eq(previewDeployments.applicationId, parent.id)
					: eq(previewDeployments.composeId, parent.id),
			orderBy: desc(previewDeployments.createdAt),
		});
		return Promise.all(previews.map(withPreviewDomain));
	}),

	/** Previews of one application (kept for existing REST/CLI callers). */
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
			const { preview } = await findPreview(input.previewDeploymentId, organizationId);
			return withPreviewDomain(preview);
		}),

	/**
	 * Spin up a per-PR variant: an application preview is the `<appName>-pr-<n>`
	 * swarm service routed at `pr-<n>-<appName>.<wildcardDomain>`; a compose
	 * preview is the whole `<appName>-pr-<n>` project, with one wildcard host
	 * per compose service that has a domain in production.
	 */
	create: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
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
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Exactly one of applicationId or composeId is required",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const parent = await assertPreviewParentAccess(input, organizationId);

			try {
				// Manual preview: the deployment row is attributed to this user
				// (webhook-driven previews pass `webhook:<provider>` instead).
				const preview = await createPreviewDeployment({
					...input,
					triggeredBy: ctx.session.user.id,
				});
				void auditFromSession(ctx, organizationId, {
					action: "previewDeployment.create",
					...auditTarget(parent),
					targetName: preview.appName,
					metadata: {
						previewDeploymentId: preview.previewDeploymentId,
						pullRequestNumber: input.pullRequestNumber,
					},
				});
				return preview;
			} catch (error) {
				if (error instanceof PreviewConflictError) {
					throw new TRPCError({ code: "CONFLICT", message: error.message });
				}
				if (error instanceof PreviewLimitError) {
					throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
				}
				if (error instanceof PreviewNotFoundError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				throw error;
			}
		}),

	/** Tear down a preview: remove the variant service / project, its routes and rows. */
	delete: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview, parent } = await findPreview(input.previewDeploymentId, organizationId);

			try {
				const result = await deletePreviewDeployment(input.previewDeploymentId);
				void auditFromSession(ctx, organizationId, {
					action: "previewDeployment.delete",
					...auditTarget(parent),
					targetName: preview.appName,
					metadata: {
						previewDeploymentId: preview.previewDeploymentId,
						pullRequestNumber: preview.pullRequestNumber,
					},
				});
				return result;
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
			const { preview, parent } = await findPreview(input.previewDeploymentId, organizationId);
			if (preview.previewStatus !== "awaiting_approval") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Preview is not awaiting approval",
				});
			}
			const result = await redeployPreviewDeployment(preview.previewDeploymentId, {
				triggeredBy: ctx.session.user.id,
			});
			if (preview.pullRequestNumber) {
				await upsertPreviewComment({
					applicationId: preview.applicationId,
					composeId: preview.composeId,
					pullRequestNumber: preview.pullRequestNumber,
					status: "deploying",
				});
			}
			void auditFromSession(ctx, organizationId, {
				action: "previewDeployment.approve",
				...auditTarget(parent),
				targetName: preview.appName,
				metadata: {
					previewDeploymentId: preview.previewDeploymentId,
					pullRequestNumber: preview.pullRequestNumber,
				},
			});
			return result;
		}),

	/** Deny a fork-PR preview awaiting approval: tears down row + route, never builds. */
	deny: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview, parent } = await findPreview(input.previewDeploymentId, organizationId);
			if (preview.previewStatus !== "awaiting_approval") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Preview is not awaiting approval",
				});
			}
			if (preview.pullRequestNumber) {
				await upsertPreviewComment({
					applicationId: preview.applicationId,
					composeId: preview.composeId,
					pullRequestNumber: preview.pullRequestNumber,
					status: "removed",
				});
			}
			try {
				const result = await deletePreviewDeployment(input.previewDeploymentId);
				void auditFromSession(ctx, organizationId, {
					action: "previewDeployment.deny",
					...auditTarget(parent),
					targetName: preview.appName,
					metadata: {
						previewDeploymentId: preview.previewDeploymentId,
						pullRequestNumber: preview.pullRequestNumber,
					},
				});
				return result;
			} catch (error) {
				if (error instanceof PreviewNotFoundError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				throw error;
			}
		}),
});
