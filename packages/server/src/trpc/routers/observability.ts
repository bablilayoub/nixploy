import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { domains } from "../../db/schema";
import { assertApplicationAccess, getServiceContext } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import {
	acknowledgeIncident,
	deleteAlertRule,
	disableStatusPage,
	enableStatusPage,
	getStatusPage,
	listAlertRules,
	listIncidents,
	listUptimeProbes,
	resolveIncident,
	rotateStatusPageToken,
	searchServiceLogs,
	setUptimeProbe,
	upsertAlertRule,
} from "../../modules/observability";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const metricSchema = z.enum(["cpu", "memory", "restarts", "deploy_failure_streak"]);

const assertDomainAccess = async (domainId: string, organizationId: string) => {
	const domain = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const owner =
		domain?.application?.environment.project.organizationId ??
		domain?.compose?.environment.project.organizationId;
	if (!domain || owner !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" });
	}
	return domain;
};

const assertComposeAccess = async (composeId: string, organizationId: string) => {
	const context = await getServiceContext("compose", composeId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	}
	return context;
};

export const observabilityRouter = router({
	incidents: protectedProcedure
		.input(
			z
				.object({
					projectId: z.string().min(1).optional(),
					limit: z.number().int().min(1).max(200).default(50),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return listIncidents(organizationId, {
				projectId: input?.projectId,
				limit: input?.limit,
			});
		}),

	/**
	 * Mark an incident as seen. Gated by `project.write` like every other
	 * observability mutation (there is no separate observability capability);
	 * audited so the timeline can say who picked it up.
	 */
	acknowledgeIncident: protectedProcedure
		.input(z.object({ incidentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			const incident = await acknowledgeIncident({
				incidentId: input.incidentId,
				organizationId,
				userId: ctx.session.user.id,
			});
			await auditFromSession(ctx, organizationId, {
				action: "incident.acknowledge",
				targetType: "incident",
				targetId: incident.incidentId,
				targetName: incident.title,
			});
			return incident;
		}),

	/** Close an incident, optionally recording what was done about it. */
	resolveIncident: protectedProcedure
		.input(
			z.object({
				incidentId: z.string().min(1),
				note: z.string().max(1000).nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			const incident = await resolveIncident({
				incidentId: input.incidentId,
				organizationId,
				userId: ctx.session.user.id,
				note: input.note ?? null,
			});
			await auditFromSession(ctx, organizationId, {
				action: "incident.resolve",
				targetType: "incident",
				targetId: incident.incidentId,
				targetName: incident.title,
			});
			return incident;
		}),

	/** Current status-page configuration for this organization (or null). */
	statusPage: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		return getStatusPage(organizationId);
	}),

	/**
	 * Publish (or re-publish) probes at `/status/<token>`. Making org data
	 * readable without authentication is an organization-level decision, so
	 * this needs `settings.manage` rather than the softer `project.write`.
	 */
	enableStatusPage: protectedProcedure
		.input(
			z.object({
				probeIds: z.array(z.string().min(1)).max(100),
				title: z.string().min(1).max(120).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "settings.manage");
			const page = await enableStatusPage({ organizationId, ...input });
			await auditFromSession(ctx, organizationId, {
				action: "statusPage.enable",
				targetType: "statusPage",
				targetId: page.statusPageId,
				targetName: page.title,
				metadata: { probes: page.probeIds.length },
			});
			return page;
		}),

	/** Take the public page offline; the token is kept so the URL can return. */
	disableStatusPage: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "settings.manage");
		const page = await disableStatusPage(organizationId);
		await auditFromSession(ctx, organizationId, {
			action: "statusPage.disable",
			targetType: "statusPage",
			targetId: page.statusPageId,
			targetName: page.title,
		});
		return page;
	}),

	/** Mint a new token, invalidating every URL shared so far. */
	rotateStatusPageToken: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "settings.manage");
		const page = await rotateStatusPageToken(organizationId);
		await auditFromSession(ctx, organizationId, {
			action: "statusPage.rotateToken",
			targetType: "statusPage",
			targetId: page.statusPageId,
			targetName: page.title,
		});
		return page;
	}),

	alertRules: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return listAlertRules(organizationId, input);
		}),

	upsertAlertRule: protectedProcedure
		.input(
			z.object({
				alertRuleId: z.string().min(1).optional(),
				applicationId: z.string().min(1).optional(),
				composeId: z.string().min(1).optional(),
				metric: metricSchema,
				threshold: z.number().positive(),
				enabled: z.boolean().optional(),
				cooldownMinutes: z.number().int().min(1).max(1440).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			if (!input.applicationId && !input.composeId && !input.alertRuleId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "applicationId or composeId is required",
				});
			}
			if (input.applicationId) {
				await assertApplicationAccess(input.applicationId, organizationId);
			}
			if (input.composeId) {
				await assertComposeAccess(input.composeId, organizationId);
			}
			return upsertAlertRule({ organizationId, ...input });
		}),

	deleteAlertRule: protectedProcedure
		.input(z.object({ alertRuleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			await deleteAlertRule(input.alertRuleId, organizationId);
			return { ok: true };
		}),

	searchLogs: protectedProcedure
		.input(
			z.object({
				query: z.string().min(1).max(200),
				serviceId: z.string().min(1).optional(),
				limit: z.number().int().min(1).max(100).default(40),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return searchServiceLogs(organizationId, input);
		}),

	uptimeProbes: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		return listUptimeProbes(organizationId);
	}),

	setUptimeProbe: protectedProcedure
		.input(
			z.object({
				domainId: z.string().min(1),
				enabled: z.boolean(),
				path: z.string().min(1).optional(),
				expectedStatus: z.number().int().min(100).max(599).optional(),
				intervalSeconds: z.number().int().min(30).max(3600).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			await assertDomainAccess(input.domainId, organizationId);
			return setUptimeProbe({ organizationId, ...input });
		}),
});
