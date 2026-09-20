import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { domains, environments, projects } from "../../db/schema";
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
	listServiceEvents,
	listUptimeProbes,
	resolveIncident,
	rotateStatusPageToken,
	SERVICE_EVENT_PAGE_SIZE,
	searchServiceLogs,
	setUptimeProbe,
	upsertAlertRule,
} from "../../modules/observability";
import {
	assertCapability,
	projectIdFilter,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { assertProjectVisible } from "../../modules/projects/project-scope";
import { applyRemediation, dismissRemediation } from "../../modules/remediation";
import {
	isEmptyQuery,
	type LogQuery,
	LogQueryError,
	parseLogQuery,
	type RuntimeLogLine,
	readRuntimeLogs,
} from "../../modules/runtime-logs";
import {
	findServiceByAppName,
	SERVICE_DEFS,
	serviceKindSchema,
} from "../../modules/services/registry";
import { protectedProcedure, router } from "../init";

const metricSchema = z.enum(["cpu", "memory", "restarts", "deploy_failure_streak"]);

/**
 * Event kinds to filter by.
 *
 * Also accepts a comma-separated string: the REST adapter flattens a query
 * string into `Record<string, string>` and cannot express an array, so
 * `?kinds=oom_killed,task_failed` is the only shape a curl or CLI caller has.
 * The panel passes a real array over tRPC.
 */
const serviceEventKindsInput = z
	.union([z.array(z.string().min(1).max(40)).max(20), z.string().min(1).max(500)])
	.optional()
	.transform((value) =>
		typeof value === "string"
			? value
					.split(",")
					.map((kind) => kind.trim())
					.filter(Boolean)
					.slice(0, 20)
			: value,
	);

const assertDomainAccess = async (domainId: string, organizationId: string) => {
	const domain = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
			externalUpstream: { with: { environment: { with: { project: true } } } },
		},
	});
	const owner =
		domain?.application?.environment.project.organizationId ??
		domain?.compose?.environment.project.organizationId ??
		domain?.externalUpstream?.environment.project.organizationId;
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

	/**
	 * A human approves a proposed remediation: the rollback runs through the
	 * same code the manual one uses, then the proposal closes with what was
	 * done. `service.deploy` because it deploys; `secrets.write` too, since a
	 * compose rollback restores the env a snapshot captured.
	 */
	applyRemediation: protectedProcedure
		.input(z.object({ incidentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			const result = await applyRemediation({
				incidentId: input.incidentId,
				organizationId,
				userId: ctx.session.user.id,
			});
			await auditFromSession(ctx, organizationId, {
				action: "incident.applyRemediation",
				targetType: "incident",
				targetId: result.incidentId,
				targetName: result.action,
				metadata: { deploymentId: result.deploymentId },
			});
			return result;
		}),

	/** A human declines a proposed remediation; the service is left alone until the next window. */
	dismissRemediation: protectedProcedure
		.input(z.object({ incidentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			const result = await dismissRemediation({
				incidentId: input.incidentId,
				organizationId,
				userId: ctx.session.user.id,
			});
			await auditFromSession(ctx, organizationId, {
				action: "incident.dismissRemediation",
				targetType: "incident",
				targetId: result.incidentId,
			});
			return result;
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
			const rule = await upsertAlertRule({ organizationId, ...input });
			void auditFromSession(ctx, organizationId, {
				action: "alertRule.upsert",
				targetType: "alertRule",
				targetId: rule?.alertRuleId ?? input.alertRuleId ?? null,
				targetName: input.metric,
				metadata: {
					applicationId: input.applicationId ?? null,
					composeId: input.composeId ?? null,
					threshold: input.threshold,
					enabled: input.enabled,
				},
			});
			return rule;
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
			void auditFromSession(ctx, organizationId, {
				action: "alertRule.delete",
				targetType: "alertRule",
				targetId: input.alertRuleId,
			});
			return { ok: true };
		}),

	/**
	 * One page of a service's event timeline, newest first.
	 *
	 * Read-only and gated by org membership alone, like `incidents`: the rows
	 * carry exit codes, task ids and changed field names, never values. The org
	 * is checked twice on purpose — once to resolve the caller's, once against
	 * the service's — because `service_event.service_id` is polymorphic and the
	 * org predicate is the only thing that makes the read tenant-safe.
	 */
	serviceEvents: protectedProcedure
		.input(
			z.object({
				serviceType: serviceKindSchema,
				serviceId: z.string().min(1),
				kinds: serviceEventKindsInput,
				/** ISO instant; the metrics charts pass their visible window. */
				since: z.string().datetime().optional(),
				limit: z.number().int().min(1).max(200).default(SERVICE_EVENT_PAGE_SIZE),
				cursor: z.string().min(1).max(200).nullish(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			const context = await getServiceContext(input.serviceType, input.serviceId);
			if (context.organizationId !== organizationId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}
			return listServiceEvents({
				organizationId,
				serviceId: input.serviceId,
				kinds: input.kinds,
				since: input.since ? new Date(input.since) : undefined,
				limit: input.limit,
				cursor: input.cursor,
			});
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

	/**
	 * Runtime log history: what a service printed, kept by the worker beyond
	 * the container's lifetime (`modules/runtime-logs`). One service by
	 * `appName`, or — without one — every service the caller can see, merged
	 * newest-first. `service.runtime`, like the live log stream.
	 *
	 * Paging is by timestamp (`before`). Org-wide, a page is cut at the
	 * newest per-service cursor so no line is skipped or repeated between
	 * pages: everything older than the cut is re-read on the next page.
	 */
	runtimeLogs: protectedProcedure
		.input(
			z.object({
				appName: z.string().min(1).max(64).optional(),
				query: z.string().max(500).optional(),
				before: z.number().int().positive().optional(),
				limit: z.number().int().min(1).max(500).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
			let query: LogQuery | null = null;
			if (input.query?.trim()) {
				try {
					query = parseLogQuery(input.query);
				} catch (error) {
					if (error instanceof LogQueryError) {
						throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
					}
					throw error;
				}
				if (isEmptyQuery(query)) query = null;
			}
			const limit = input.limit ?? 200;
			type Line = RuntimeLogLine & { appName: string };

			if (input.appName) {
				const service = await findServiceByAppName(input.appName);
				if (!service || service.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
				}
				assertProjectVisible(service.projectId, "Service");
				const page = await readRuntimeLogs({
					appName: input.appName,
					query,
					before: input.before ?? null,
					limit,
				});
				const appName = input.appName;
				return {
					lines: page.lines.map((line): Line => ({ ...line, appName })),
					nextCursor: page.nextCursor,
					truncated: page.truncated,
					scanned: page.scanned,
				};
			}

			// Org-wide: every service in a project the caller can see.
			const orgProjects = await db.query.projects.findMany({
				where: and(
					eq(projects.organizationId, organizationId),
					projectIdFilter(projects.projectId),
				),
				columns: { projectId: true },
			});
			const environmentRows =
				orgProjects.length === 0
					? []
					: await db.query.environments.findMany({
							where: inArray(
								environments.projectId,
								orgProjects.map((row) => row.projectId),
							),
							columns: { environmentId: true },
						});
			const envIds = environmentRows.map((row) => row.environmentId);
			const summaries =
				envIds.length === 0
					? []
					: (await Promise.all(SERVICE_DEFS.map((def) => def.module.listSummaries(envIds)))).flat();

			const deadline = Date.now() + 4_000;
			const lines: Line[] = [];
			let cut: number | null = null;
			let truncated = false;
			let scanned = 0;
			for (const summary of summaries) {
				const budgetMs = deadline - Date.now();
				if (budgetMs <= 0) {
					truncated = true;
					break;
				}
				const page = await readRuntimeLogs({
					appName: summary.appName,
					query,
					before: input.before ?? null,
					limit,
					budgetMs,
				});
				scanned += page.scanned;
				truncated ||= page.truncated;
				for (const line of page.lines) lines.push({ ...line, appName: summary.appName });
				if (page.nextCursor !== null)
					cut = cut === null ? page.nextCursor : Math.max(cut, page.nextCursor);
			}
			lines.sort((a, b) => b.t - a.t);
			// Only the range every service has fully covered is returned; the
			// rest comes back on the next page from `cut` down.
			const covered = cut === null ? lines : lines.filter((line) => line.t >= (cut as number));
			const page = covered.slice(0, limit);
			const last = page[page.length - 1];
			const nextCursor = covered.length > limit ? (last?.t ?? cut) : cut;
			return { lines: page, nextCursor, truncated, scanned };
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
			await assertDomainAccess(input.domainId, organizationId);
			const probe = await setUptimeProbe({
				organizationId,
				actorUserId: ctx.session.user.id,
				...input,
			});
			void auditFromSession(ctx, organizationId, {
				action: "uptimeProbe.set",
				targetType: "domain",
				targetId: input.domainId,
				metadata: {
					enabled: input.enabled,
					path: input.path ?? "/",
					intervalSeconds: input.intervalSeconds,
				},
			});
			return probe;
		}),
});
