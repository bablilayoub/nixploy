import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { NIXPLOY_STACK_VERSION } from "../../modules/gitops";
import { applyImport, IMPORT_SOURCES, inspectSource, planImport } from "../../modules/import";
import {
	assertCapability,
	assertWithinQuota,
	findProjectById,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { assertApplyPermissions } from "../apply-permissions";
import { protectedProcedure, router } from "../init";

/**
 * Import from another panel over its API. Every procedure takes the source
 * API key in its input and forgets it when the call returns: nothing is
 * stored, audit rows carry the source host and counts only. All three are
 * mutations so the key never rides a GET query string into a log.
 */

const sourceInput = z
	.object({
		source: z.enum(IMPORT_SOURCES),
		/** Live path: the running source panel. */
		url: z.string().min(1).max(2048).optional(),
		apiKey: z.string().min(1).max(4096).optional(),
		/** Offline path: a dump uploaded to `POST /api/import/dump`. */
		dumpId: z
			.string()
			.regex(/^[a-f0-9]{24}$/)
			.optional(),
	})
	.refine((value) => Boolean(value.dumpId) !== Boolean(value.url && value.apiKey), {
		message: "Give url + apiKey (live panel) or dumpId (uploaded dump), not both",
	});

const importInput = sourceInput.extend({
	sourceProjectId: z.string().min(1),
	sourceEnvironmentName: z.string().min(1).max(255).optional(),
	projectId: z.string().min(1).optional(),
	environmentName: z.string().min(1).max(255).optional(),
	keepAppNames: z.boolean().optional(),
});

const countServices = (manifest: {
	applications?: unknown[];
	compose?: unknown[];
	databases?: Record<string, unknown[] | undefined>;
}): number =>
	(manifest.applications?.length ?? 0) +
	(manifest.compose?.length ?? 0) +
	Object.values(manifest.databases ?? {}).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);

export const importRouter = router({
	/** What the source key can see: projects, environments, service counts. */
	inspect: protectedProcedure.input(sourceInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
		return inspectSource(input, organizationId);
	}),

	/** Fetch one source environment, translate it and diff it against the target. Writes nothing. */
	plan: protectedProcedure.input(importInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
		if (input.projectId) await findProjectById(input.projectId, organizationId);
		const includeSensitive = await hasCapability(
			ctx.session.user.id,
			organizationId,
			"secrets.read",
		);
		return planImport(input, organizationId, { includeSensitive });
	}),

	/**
	 * Create what is missing, write the rows and the env values. Deploys
	 * nothing: services land idle, the operator deploys once the notes are
	 * handled. Same gates as a GitOps apply plus `secrets.write` (values are
	 * written) and `project.write` when the project is created.
	 */
	runApply: protectedProcedure.input(importInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "gitops.manage");
		await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
		if (input.projectId) await findProjectById(input.projectId, organizationId);
		const includeSensitive = await hasCapability(
			ctx.session.user.id,
			organizationId,
			"secrets.read",
		);

		// The plan is what decides the gates; the source is read twice (plan,
		// then apply) so the apply writes exactly what was checked.
		const plan = await planImport(input, organizationId, { includeSensitive });
		if (plan.target.createsProject || plan.target.createsEnvironment) {
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			if (plan.target.createsProject) {
				await assertWithinQuota(organizationId, { projects: true });
			}
		}
		await assertApplyPermissions(
			ctx.session,
			organizationId,
			plan.manifest,
			plan.target.projectId ?? undefined,
			false,
			includeSensitive,
			plan.plan ? undefined : countServices(plan.manifest),
		);

		const result = await applyImport(input, organizationId, { includeSensitive });
		await auditFromSession(ctx, organizationId, {
			action: "import.runApply",
			targetType: "project",
			targetId: result.target.projectId,
			targetName: result.target.projectName,
			metadata: {
				source: input.source,
				host: result.source.host,
				manifestVersion: NIXPLOY_STACK_VERSION,
				environment: result.target.environmentName,
				counts: result.counts,
				applied: result.result.applied,
				failed: result.result.errors.length,
				secretsApplied: result.secrets.applied.length,
				notes: result.notes.length,
			},
		});
		return result;
	}),
});
