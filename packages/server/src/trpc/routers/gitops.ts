import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	applySecretsPayload,
	applyStack,
	collectSecrets,
	exportStack,
	fetchStackYamlFromUrl,
	loadEnvironmentGraph,
	nixployStackSchema,
	openSecretsBundle,
	parseStackInput,
	passphraseSchema,
	planStack,
	redeployChangedFromApply,
	sealSecretsBundle,
	serializeStackYaml,
	summarizeSecrets,
} from "../../modules/gitops";
import {
	assertCapability,
	findProjectById,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { textBlobSchema } from "../../utils/input-limits";
import { assertApplyPermissions } from "../apply-permissions";
import { protectedProcedure, router } from "../init";

const stackInputSchema = z
	.object({
		stack: nixployStackSchema.optional(),
		yaml: textBlobSchema.min(1).optional(),
		projectId: z.string().min(1).optional(),
	})
	.refine((value) => Boolean(value.stack) !== Boolean(value.yaml), {
		message: "Provide exactly one of stack or yaml",
	});

/** A sealed secrets bundle and the passphrase that opens it. */
const secretsInputSchema = z.object({
	bundle: textBlobSchema.min(1),
	passphrase: passphraseSchema,
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

	/**
	 * Apply desired stack (admin only). Optionally queue redeploys for changed
	 * apps/compose. With `secrets`, the bundle's values are written onto the
	 * rows after the manifest and before the redeploy, so a moved environment
	 * comes up with its env in one call.
	 */
	runApply: protectedProcedure
		.input(
			stackInputSchema.extend({
				redeploy: z.boolean().optional(),
				secrets: secretsInputSchema.optional(),
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
			// Opened before anything is written: a wrong passphrase must not
			// leave a half-applied environment behind.
			const secrets = input.secrets
				? openSecretsBundle(input.secrets.bundle, input.secrets.passphrase)
				: null;
			if (secrets) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
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
			const secretsResult = secrets
				? await applySecretsPayload(
						secrets,
						await loadEnvironmentGraph(result.projectId, result.environmentName, organizationId),
					)
				: null;
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
					...(secretsResult
						? {
								secretsApplied: secretsResult.applied.length,
								secretsMissing: secretsResult.missing,
							}
						: {}),
				},
			});
			return { ...result, redeploy, secrets: secretsResult };
		}),

	/**
	 * Seal the environment's env values (project, environment, every service
	 * by name, build args and preview env) with a passphrase. The manifest
	 * carries keys only; this is the other half of a move.
	 */
	exportSecrets: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
				passphrase: passphraseSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await findProjectById(input.projectId, organizationId);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.read");
			const graph = await loadEnvironmentGraph(
				input.projectId,
				input.environmentName,
				organizationId,
			);
			const payload = collectSecrets(graph);
			const summary = summarizeSecrets(payload);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.exportSecrets",
				targetType: "project",
				targetId: input.projectId,
				targetName: graph.project.name,
				metadata: { environment: input.environmentName, ...summary },
			});
			return { bundle: sealSecretsBundle(payload, input.passphrase), ...summary };
		}),

	/** Write a sealed bundle's values onto this environment, matching services by name. */
	applySecrets: protectedProcedure
		.input(
			secretsInputSchema.extend({
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await findProjectById(input.projectId, organizationId);
			await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			const payload = openSecretsBundle(input.bundle, input.passphrase);
			const graph = await loadEnvironmentGraph(
				input.projectId,
				input.environmentName,
				organizationId,
			);
			const result = await applySecretsPayload(payload, graph);
			await auditFromSession(ctx, organizationId, {
				action: "gitops.applySecrets",
				targetType: "project",
				targetId: input.projectId,
				targetName: graph.project.name,
				metadata: {
					environment: input.environmentName,
					applied: result.applied.length,
					missing: result.missing,
					source: result.source,
				},
			});
			return result;
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
