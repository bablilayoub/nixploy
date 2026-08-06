import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { domains } from "../../db/schema";
import { assertApplicationAccess, getServiceContext } from "../../modules/application";
import {
	deleteAlertRule,
	ingestServiceLog,
	listAlertRules,
	listIncidents,
	listUptimeProbes,
	searchServiceLogs,
	setUptimeProbe,
	upsertAlertRule,
} from "../../modules/observability";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
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
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
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
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
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

	ingestLog: protectedProcedure
		.input(
			z.object({
				serviceId: z.string().min(1),
				serviceType: z.enum(["application", "compose"]),
				deploymentId: z.string().optional(),
				body: z.string().min(1).max(200_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const service = await getServiceContext(input.serviceType, input.serviceId);
			if (service.organizationId !== organizationId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}
			await ingestServiceLog({ organizationId, ...input });
			return { ok: true };
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
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			await assertDomainAccess(input.domainId, organizationId);
			return setUptimeProbe({ organizationId, ...input });
		}),
});
