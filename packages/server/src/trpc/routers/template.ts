import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { templateSources } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import {
	assertCapability,
	assertOrgRole,
	assertWithinQuota,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import {
	assertTemplateSourceUrl,
	deployTemplate,
	findTemplateForOrg,
	findTemplateSource,
	listTemplateSources,
	listTemplateSummariesForOrg,
	readTemplateSourceReport,
	removeTemplateSourceCache,
	summarizeTemplateServices,
	syncTemplateSource,
} from "../../modules/templates";
import { planTemplateDomains } from "../../modules/templates/domains";
import { templateNeedsInstanceAdmin } from "../../modules/templates/safety";
import { protectedProcedure, router } from "../init";

/**
 * Organization whose template sources are merged into the catalog, or `null`
 * for a caller that belongs to none.
 *
 * The built-in catalog is identical for every authenticated user, so falling
 * back to it is not a leak — and it keeps `template.all` / `template.one`
 * working for callers with no organization, which is what they did before
 * sources existed (MCP `list_templates`, the CLI). Every WRITE path resolves
 * the organization strictly.
 */
async function catalogOrganizationId(session: {
	user: { id: string };
	session: { activeOrganizationId?: string | null };
}): Promise<string | null> {
	return await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	).catch(() => null);
}

const sourceKindSchema = z.enum(["git", "http-json", "blueprints"]);
const sourceUrlSchema = z.string().min(1).max(2048);

/**
 * Remote template catalogs (product audit, Platform row "Templates are a
 * fixed TS catalog"). Org-scoped: a source belongs to one organization and is
 * only ever merged into that organization's gallery. Managing them is an
 * org-admin action — a source's compose bodies become deployable templates.
 *
 * Flat `sourcesX` names rather than a nested `sources` sub-router on purpose:
 * the REST adapter resolves `/api/<router>.<procedure>` by splitting on the
 * FIRST dot and indexing the caller twice (`apps/web/src/app/api/[...rest]`),
 * so a nested router is unreachable over REST, the CLI and MCP.
 */
const templateSourceProcedures = {
	sourcesList: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const rows = await listTemplateSources(organizationId);
		return await Promise.all(
			rows.map(async (row) => ({
				...row,
				report: await readTemplateSourceReport(row.templateSourceId),
			})),
		);
	}),

	sourcesCreate: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(120),
				url: sourceUrlSchema,
				kind: sourceKindSchema.default("http-json"),
				branch: z.string().max(255).nullish(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			await assertTemplateSourceUrl(input.kind, input.url);
			const [row] = await db
				.insert(templateSources)
				.values({
					name: input.name,
					url: input.url,
					kind: input.kind,
					branch: input.branch ?? null,
					enabled: input.enabled ?? true,
					organizationId,
				})
				.returning();
			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "template.source.create",
				targetType: "template_source",
				targetId: row.templateSourceId,
				targetName: row.name,
				metadata: { kind: row.kind, url: row.url },
			});
			return row;
		}),

	sourcesUpdate: protectedProcedure
		.input(
			z.object({
				templateSourceId: z.string().min(1),
				name: z.string().min(1).max(120).optional(),
				url: sourceUrlSchema.optional(),
				kind: sourceKindSchema.optional(),
				branch: z.string().max(255).nullish(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const row = await findTemplateSource(input.templateSourceId, organizationId);
			const { templateSourceId, ...values } = input;
			if (Object.values(values).every((value) => value === undefined)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Nothing to update — pass at least one field",
				});
			}
			if (values.url !== undefined || values.kind !== undefined) {
				await assertTemplateSourceUrl(values.kind ?? row.kind, values.url ?? row.url);
			}
			const [updated] = await db
				.update(templateSources)
				.set(values)
				.where(eq(templateSources.templateSourceId, templateSourceId))
				.returning();
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Template source not found" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "template.source.update",
				targetType: "template_source",
				targetId: updated.templateSourceId,
				targetName: updated.name,
				metadata: { kind: updated.kind, url: updated.url, enabled: updated.enabled },
			});
			return updated;
		}),

	sourcesDelete: protectedProcedure
		.input(z.object({ templateSourceId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const row = await findTemplateSource(input.templateSourceId, organizationId);
			await db
				.delete(templateSources)
				.where(eq(templateSources.templateSourceId, row.templateSourceId));
			await removeTemplateSourceCache(row.templateSourceId);
			void auditFromSession(ctx, organizationId, {
				action: "template.source.delete",
				targetType: "template_source",
				targetId: row.templateSourceId,
				targetName: row.name,
			});
			return true;
		}),

	/**
	 * Fetch the source now: validate every entry, probe the images it
	 * references and rewrite the cache. Rejected entries and unreachable
	 * images come back as diagnostics — they do not fail the sync.
	 */
	sourcesSync: protectedProcedure
		.input(z.object({ templateSourceId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const row = await findTemplateSource(input.templateSourceId, organizationId);
			const result = await syncTemplateSource(row);
			void auditFromSession(ctx, organizationId, {
				action: "template.source.sync",
				targetType: "template_source",
				targetId: row.templateSourceId,
				targetName: row.name,
				metadata: {
					templateCount: result.templateCount,
					rejected: result.rejected.length,
					imageWarnings: result.imageWarnings.length,
				},
			});
			return result;
		}),
};

export const templateRouter = router({
	/** Template catalog without compose bodies (for the gallery grid). */
	all: protectedProcedure.query(async ({ ctx }) => {
		return await listTemplateSummariesForOrg(await catalogOrganizationId(ctx.session));
	}),

	/** A single template including its compose body, env schema and services. */
	one: protectedProcedure
		.input(z.object({ templateId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const template = await findTemplateForOrg(
				await catalogOrganizationId(ctx.session),
				input.templateId,
			);
			if (!template) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
			}
			return {
				...template,
				services: summarizeTemplateServices(template.compose, template.suggestedDomain.serviceName),
			};
		}),

	/**
	 * Instantiate a template into a project environment: creates a raw compose
	 * service (compose file + resolved `.env`), optionally attaches domains and
	 * enqueues the first deployment.
	 *
	 * Host-privileged templates (Docker socket / elevated caps) require the
	 * instance admin role.
	 */
	deploy: protectedProcedure
		.input(
			z.object({
				templateId: z.string().min(1),
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
				envValues: z.record(z.string(), z.string()).optional(),
				domains: z
					.array(
						z.object({
							host: z.string().min(1).max(255),
							serviceName: z.string().min(1),
							port: z.number().int().min(1).max(65535),
						}),
					)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "templates.deploy");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			const template = await findTemplateForOrg(organizationId, input.templateId);
			if (!template) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
			}
			// Host access and published host ports are the two things a template
			// can ask for that a member may not grant themselves: the first
			// escapes the container baseline, the second escapes Traefik (and
			// with it domains, TLS, middlewares and the access log). Read from
			// the compose file, not the cached flag — `templateNeedsInstanceAdmin`.
			if (templateNeedsInstanceAdmin(template)) {
				await assertInstanceAdmin(ctx.session);
			}
			// Hint domains come from the env values; a wildcard among them is an
			// instance-admin row, exactly as it is on domain.create.
			const hinted = planTemplateDomains(template, input.envValues ?? {});
			if ((input.domains && input.domains.length > 0) || hinted.length > 0) {
				await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
			}
			if (hinted.some((entry) => entry.wildcard)) {
				try {
					await assertInstanceAdmin(ctx.session);
				} catch {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Wildcard domains can only be added by the instance administrator — leave ${hinted.find((entry) => entry.wildcard)?.env} at its placeholder and add the wildcard later`,
					});
				}
			}
			// A template becomes one compose service — same cap as compose.create.
			await assertWithinQuota(organizationId, { services: true });
			const deployed = await deployTemplate(organizationId, input);
			void auditFromSession(ctx, organizationId, {
				action: "template.deploy",
				targetType: "compose",
				targetId: deployed.composeId,
				targetName: deployed.appName,
				metadata: {
					templateId: template.id,
					projectId: input.projectId,
					environmentName: input.environmentName,
					hostPrivileged: template.hostPrivileged ?? false,
					publishPorts: deployed.publishPorts,
					domains: input.domains?.length ?? 0,
					hintDomains: deployed.domains.filter((entry) => entry.status === "attached").length,
				},
			});
			return deployed;
		}),

	...templateSourceProcedures,
});
