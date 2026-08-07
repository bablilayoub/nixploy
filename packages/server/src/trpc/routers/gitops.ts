import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	applyStack,
	exportStack,
	fetchStackYamlFromUrl,
	nixployStackSchema,
	parseStackInput,
	planStack,
	redeployChangedFromApply,
	serializeStackYaml,
} from "../../modules/gitops";
import {
	assertCapability,
	findProjectById,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { protectedProcedure, router } from "../init";

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
			const stack = await exportStack(input.projectId, input.environmentName, organizationId);
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
					redeployed: redeploy?.deploymentIds.length ?? 0,
				},
			});
			return { ...result, redeploy, yamlLength: yaml.length };
		}),
});
