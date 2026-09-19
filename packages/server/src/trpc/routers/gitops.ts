import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
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
	stackSensitivity,
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
import { textBlobSchema } from "../../utils/input-limits";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/**
 * Apply/sync are compound mutations: on top of `gitops.manage` the caller
 * needs the same per-action capabilities the normal routers gate on —
 * `service.create` (+ the service quota) for every service the plan would
 * create, `service.write` for updates, `service.deploy` when the changed
 * applications/compose get redeployed, `secrets.write` when the file carries
 * hook commands, basic-auth passwords or file-mount contents, and the
 * instance admin for what the panel forms reserve for it (bind mounts,
 * Swarm network/privilege overrides, publishing compose ports). The plan is
 * computed against the live state before anything is written.
 */
async function assertApplyPermissions(
	session: Session,
	organizationId: string,
	stack: NixployStack,
	projectId: string | undefined,
	redeploy: boolean,
	includeSensitive: boolean,
): Promise<void> {
	const sensitivity = stackSensitivity(stack);
	if (sensitivity.secrets) {
		await assertCapability(session.user.id, organizationId, "secrets.write");
	}
	if (sensitivity.instanceAdmin.length > 0) {
		await assertInstanceAdmin(session);
	}
	const plan = await planStack(stack, organizationId, projectId, { includeSensitive });
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
		yaml: textBlobSchema.min(1).optional(),
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
			const includeSensitive = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			const stack = await exportStack(input.projectId, input.environmentName, organizationId, {
				includeSensitive,
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
			return planStack(stack, organizationId, input.projectId, {
				includeSensitive: await hasCapability(ctx.session.user.id, organizationId, "secrets.read"),
			});
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
			const includeSensitive = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
				includeSensitive,
			);
			const result = await applyStack(stack, organizationId, input.projectId, {
				includeSensitive,
			});
			const redeploy =
				input.redeploy === false
					? null
					: await redeployChangedFromApply(result, { triggeredBy: ctx.session.user.id });
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
				yaml: textBlobSchema.min(1),
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
			const includeSensitive = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
				includeSensitive,
			);
			const result = await applyStack(stack, organizationId, input.projectId, {
				includeSensitive,
			});
			const redeploy =
				input.redeploy === false
					? null
					: await redeployChangedFromApply(result, { triggeredBy: ctx.session.user.id });
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
			const includeSensitive = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			await assertApplyPermissions(
				ctx.session,
				organizationId,
				stack,
				input.projectId,
				input.redeploy !== false,
				includeSensitive,
			);
			const result = await applyStack(stack, organizationId, input.projectId, {
				includeSensitive,
			});
			const redeploy =
				input.redeploy === false
					? null
					: await redeployChangedFromApply(result, { triggeredBy: ctx.session.user.id });
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
