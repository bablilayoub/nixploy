import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	applyStack,
	exportStack,
	fetchStackYamlFromUrl,
	type NixployStack,
	nixployStackSchema,
	parseStackInput,
	planStack,
	redeployChangedFromApply,
	serializeStackYaml,
	summarizePlanNeeds,
} from "../../modules/gitops";
import {
	assertCapability,
	findProjectById,
	getOrganizationServiceStatusCounts,
	getOrgQuotas,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/**
 * Apply/sync are compound mutations: on top of `gitops.manage` the caller
 * needs the same per-action capabilities the normal routers gate on —
 * `service.create` (+ the service quota) for every service the plan would
 * create, `service.write` for updates, `service.deploy` when the changed
 * applications/compose get redeployed. The plan is computed against the
 * live state before anything is written.
 */
async function assertApplyPermissions(
	session: Session,
	organizationId: string,
	stack: NixployStack,
	projectId: string | undefined,
	redeploy: boolean,
): Promise<void> {
	const plan = await planStack(stack, organizationId, projectId);
	const needs = summarizePlanNeeds(plan);
	if (needs.creates > 0) {
		await assertCapability(session.user.id, organizationId, "service.create");
		const quotas = await getOrgQuotas(organizationId);
		if (quotas.maxServices != null) {
			const counts = await getOrganizationServiceStatusCounts(organizationId);
			if (counts.total + needs.creates > quotas.maxServices) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Service limit reached (${quotas.maxServices} max; this apply would create ${needs.creates})`,
				});
			}
		}
	}
	if (needs.writes) {
		await assertCapability(session.user.id, organizationId, "service.write");
	}
	if (redeploy && needs.redeploys > 0) {
		await assertCapability(session.user.id, organizationId, "service.deploy");
	}
}

const stackInputSchema = z
	.object({
		stack: nixployStackSchema.optional(),
		yaml: z.string().min(1).optional(),
		projectId: z.string().min(1).optional(),
	})
	.refine((value) => Boolean(value.stack) !== Boolean(value.yaml), {
		message: "Provide exactly one of stack or yaml",
	});

export const gitopsRouter = router({
	/** Export the current project + environment as a nixploy stack object. */
	exportStack: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
				asYaml: z.boolean().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await findProjectById(input.projectId, organizationId);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			const includeComposeFile = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			const stack = await exportStack(input.projectId, input.environmentName, organizationId, {
				includeComposeFile,
			});
			if (input.asYaml) {
				return { stack, yaml: serializeStackYaml(stack) };
			}
			return { stack };
		}),

	/** Diff desired stack vs live state. */
	plan: protectedProcedure
		.input(
			stackInputSchema.extend({
				dry: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			const stack = parseStackInput(input);
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			return planStack(stack, organizationId, input.projectId);
		}),

	/** Apply desired stack (admin only). Optionally queue redeploys for changed apps/compose. */
	runApply: protectedProcedure
		.input(stackInputSchema.extend({ redeploy: z.boolean().optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			const stack = parseStackInput(input);
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
			);
			const result = await applyStack(stack, organizationId, input.projectId);
			const redeploy = input.redeploy === false ? null : await redeployChangedFromApply(result);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.runApply",
				targetType: "project",
				targetId: result.projectId,
				targetName: stack.project.name,
				metadata: {
					summary: result.summary,
					applied: result.applied,
					failed: result.errors.length,
					redeployed: redeploy?.deploymentIds.length ?? 0,
				},
			});
			return { ...result, redeploy };
		}),

	/**
	 * Apply raw YAML (paste / webhook body). Optionally redeploy changed services.
	 */
	syncFromGit: protectedProcedure
		.input(
			z.object({
				yaml: z.string().min(1),
				projectId: z.string().min(1).optional(),
				redeploy: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			const stack = parseStackInput({ yaml: input.yaml });
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
			);
			const result = await applyStack(stack, organizationId, input.projectId);
			const redeploy = input.redeploy === false ? null : await redeployChangedFromApply(result);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.syncFromGit",
				targetType: "project",
				targetId: result.projectId,
				targetName: stack.project.name,
				metadata: {
					summary: result.summary,
					applied: result.applied,
					failed: result.errors.length,
					redeployed: redeploy?.deploymentIds.length ?? 0,
				},
			});
			return { ...result, redeploy };
		}),

	/**
	 * Pull stack YAML from an HTTPS URL (raw GitHub/GitLab file) and apply.
	 * Redeploys changed applications/compose by default.
	 */
	syncFromUrl: protectedProcedure
		.input(
			z.object({
				url: z.string().url().max(2048),
				projectId: z.string().min(1).optional(),
				redeploy: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			const yaml = await fetchStackYamlFromUrl(input.url);
			const stack = parseStackInput({ yaml });
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
			);
			const result = await applyStack(stack, organizationId, input.projectId);
			const redeploy = input.redeploy === false ? null : await redeployChangedFromApply(result);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.syncFromUrl",
				targetType: "project",
				targetId: result.projectId,
				targetName: stack.project.name,
				metadata: {
					url: input.url,
					summary: result.summary,
					applied: result.applied,
					failed: result.errors.length,
					redeployed: redeploy?.deploymentIds.length ?? 0,
				},
			});
			return { ...result, redeploy, yamlLength: yaml.length };
		}),
});
