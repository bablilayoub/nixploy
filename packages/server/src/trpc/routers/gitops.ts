import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	applyStack,
	exportStack,
	nixployStackSchema,
	parseStackInput,
	planStack,
	serializeStackYaml,
} from "../../modules/gitops";
import {
	assertOrgRole,
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
			const stack = parseStackInput(input);
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			return planStack(stack, organizationId, input.projectId);
		}),

	/** Apply desired stack (admin only). Does not trigger deployments. */
	runApply: protectedProcedure.input(stackInputSchema).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const stack = parseStackInput(input);
		if (input.projectId) {
			await findProjectById(input.projectId, organizationId);
		}
		const result = await applyStack(stack, organizationId, input.projectId);
		await auditFromSession(ctx, organizationId, {
			action: "gitops.runApply",
			targetType: "project",
			targetId: result.projectId,
			targetName: stack.project.name,
			metadata: { summary: result.summary, applied: result.applied },
		});
		return result;
	}),

	/**
	 * Lightweight webhook/sync entrypoint: accepts raw YAML and applies it.
	 * Reuses the same apply path — no git clone required.
	 */
	syncFromGit: protectedProcedure
		.input(
			z.object({
				yaml: z.string().min(1),
				projectId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const stack = parseStackInput({ yaml: input.yaml });
			if (input.projectId) {
				await findProjectById(input.projectId, organizationId);
			}
			const result = await applyStack(stack, organizationId, input.projectId);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.syncFromGit",
				targetType: "project",
				targetId: result.projectId,
				targetName: stack.project.name,
				metadata: { summary: result.summary, applied: result.applied },
			});
			return result;
		}),
});
