import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { previewDeployments } from "../../db/schema";
import { assertApplicationAccess, getOrganizationId } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { findComposeForOrg } from "../../modules/compose/service";
import { LOGICAL_DATABASE_KINDS } from "../../modules/databases/logical";
import {
	createPreviewDeployment,
	deletePreviewDeployment,
	type PreviewParentRef,
	previewKeyForRef,
	previewParentRef,
	redeployPreviewDeployment,
	withPreviewDomain,
} from "../../modules/preview";
import { upsertPreviewComment } from "../../modules/preview/comment";
import { logicalServiceModule } from "../../modules/preview/database";
import { assertCapability } from "../../modules/projects";
import { assertSafeGitRef } from "../../utils/public-url";
import { assertSafeDockerImageRef } from "../../utils/validators";
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

	/**
	 * Database services a parent may pick for per-preview databases: the
	 * logical-capable engines of its own environment (a preview reaches its
	 * database over the environment overlay).
	 */
	databaseTargets: protectedProcedure.input(parentInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const parent = await assertPreviewParentAccess(input, organizationId);
		const environmentId =
			parent.kind === "application"
				? (await assertApplicationAccess(parent.id, organizationId)).environmentId
				: (await findComposeForOrg(parent.id, organizationId)).environmentId;
		const rows = await Promise.all(
			LOGICAL_DATABASE_KINDS.map(async (kind) =>
				(await logicalServiceModule(kind).listByEnvironment(environmentId)).map((row) => ({
					kind,
					id: logicalServiceModule(kind).rowId(row),
					name: row.name,
					appName: row.appName,
				})),
			),
		);
		return rows.flat();
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
					/** A pull-request preview; omit and give `ref` for a branch preview. */
					pullRequestNumber: z
						.string()
						.min(1)
						.max(16)
						.regex(/^\d+$/, "pullRequestNumber must be numeric")
						.optional(),
					/** A branch, tag or sha to preview without a pull request. */
					ref: z.string().min(1).max(255).optional(),
					/** A prebuilt image to run instead of building (applications only). */
					image: z.string().min(1).max(512).optional(),
					branch: z.string().nullable().optional(),
					pullRequestId: z.string().nullable().optional(),
					pullRequestTitle: z.string().max(500).nullable().optional(),
					pullRequestURL: z.string().url().nullable().optional(),
					expiresAt: z.date().nullable().optional(),
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Exactly one of applicationId or composeId is required",
				})
				.refine(
					(value) => [value.pullRequestNumber, value.ref, value.image].filter(Boolean).length === 1,
					{
						message:
							"Give exactly one of pullRequestNumber (pull-request preview), ref (branch preview) or image (image preview)",
					},
				),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const parent = await assertPreviewParentAccess(input, organizationId);

			// A branch preview is keyed by a short hash of the ref, an image
			// preview by one of the image, so the same source maps to the same
			// variant and a second create is a conflict.
			const { ref, image, ...rest } = input;
			if (image && parent.kind !== "application") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "An image preview needs an application; a compose stack has no single image",
				});
			}
			const source = input.pullRequestNumber
				? { kind: "pull_request" as const, pullRequestNumber: input.pullRequestNumber }
				: image
					? {
							kind: "image" as const,
							pullRequestNumber: previewKeyForRef(`image:${assertSafeDockerImageRef(image)}`),
							image: assertSafeDockerImageRef(image),
						}
					: {
							kind: "branch" as const,
							pullRequestNumber: previewKeyForRef(assertSafeGitRef(ref ?? "", "ref")),
							branch: assertSafeGitRef(ref ?? "", "ref"),
						};

			// Manual preview: the deployment row is attributed to this user
			// (webhook-driven previews pass `webhook:<provider>` instead).
			const preview = await createPreviewDeployment({
				...rest,
				...source,
				triggeredBy: ctx.session.user.id,
			});
			void auditFromSession(ctx, organizationId, {
				action: "previewDeployment.create",
				...auditTarget(parent),
				targetName: preview.appName,
				metadata: {
					previewDeploymentId: preview.previewDeploymentId,
					kind: source.kind,
					pullRequestNumber: source.pullRequestNumber,
					ref: source.kind === "branch" ? source.branch : undefined,
					image: source.kind === "image" ? source.image : undefined,
				},
			});
			return preview;
		}),

	/**
	 * Build the preview again from its ref — a branch preview after a push,
	 * a PR preview whose webhook was missed. Not for a preview parked behind
	 * the fork gate: `approve` is the only way through that.
	 */
	redeploy: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview, parent } = await findPreview(input.previewDeploymentId, organizationId);
			if (preview.previewStatus === "awaiting_approval") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This preview is awaiting approval — approve it instead of redeploying",
				});
			}
			const result = await redeployPreviewDeployment(preview.previewDeploymentId, {
				triggeredBy: ctx.session.user.id,
			});
			void auditFromSession(ctx, organizationId, {
				action: "previewDeployment.redeploy",
				...auditTarget(parent),
				targetName: preview.appName,
				metadata: {
					previewDeploymentId: preview.previewDeploymentId,
					deploymentId: result.deploymentId,
				},
			});
			return result;
		}),

	/** Tear down a preview: remove the variant service / project, its routes and rows. */
	delete: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { preview, parent } = await findPreview(input.previewDeploymentId, organizationId);

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
		}),
});
