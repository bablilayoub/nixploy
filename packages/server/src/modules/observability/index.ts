import { and, count, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { alertRules, deployments, incidents, serviceLogs, uptimeProbes } from "../../db/schema";
import { assertSafeOutboundUrl, pinnedFetch } from "../../utils/public-url";
import { badRequest, notFound } from "../errors";
import { notifyEvent } from "../notifications";
import { assertCapability } from "../projects/capabilities";
import { projectIdFilter } from "../projects/project-scope";

export {
	mirrorAuditOntoTimeline,
	serviceEventFromAudit,
} from "./audit-events";
export { recordDeploymentEvent, recordDeploymentOutcomeEvent } from "./deploy-events";
export {
	isServiceEventKind,
	SERVICE_EVENT_CHART_KINDS,
	SERVICE_EVENT_KIND_LABELS,
	SERVICE_EVENT_KIND_SEVERITY,
	SERVICE_EVENT_KINDS,
	type ServiceEventKind,
	type ServiceEventSeverity,
	serviceEventKindLabel,
} from "./event-kinds";
export {
	deleteServiceEvents,
	listServiceEvents,
	pruneServiceEvents,
	recentServiceEvents,
	recordServiceEvent,
	recordServiceEventDetached,
	recordServiceEvents,
	SERVICE_EVENT_PAGE_SIZE,
	type ServiceEventInput,
	type ServiceEventRow,
} from "./service-events";
export {
	disableStatusPage,
	enableStatusPage,
	generateStatusPageToken,
	getStatusPage,
	loadPublicStatus,
	type PublicStatus,
	type PublicStatusIncident,
	type PublicStatusProbe,
	rotateStatusPageToken,
	STATUS_PAGE_UPTIME_DAYS,
	type StatusPageRow,
	uptimePercentFromEvents,
} from "./status-page";

export async function recordIncident(input: {
	organizationId: string;
	projectId?: string | null;
	kind: string;
	severity?: string;
	title: string;
	message?: string;
	serviceId?: string | null;
	serviceName?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<typeof incidents.$inferSelect> {
	const [row] = await db
		.insert(incidents)
		.values({
			organizationId: input.organizationId,
			projectId: input.projectId ?? null,
			kind: input.kind,
			severity: input.severity ?? "warning",
			title: input.title,
			message: input.message ?? null,
			serviceId: input.serviceId ?? null,
			serviceName: input.serviceName ?? null,
			metadata: input.metadata ?? null,
		})
		.returning();
	if (!row) {
		throw new Error("Failed to record incident");
	}
	return row;
}

export async function listIncidents(
	organizationId: string,
	opts: { projectId?: string; limit?: number } = {},
) {
	const limit = opts.limit ?? 50;
	const conditions = [eq(incidents.organizationId, organizationId)];
	if (opts.projectId) {
		conditions.push(eq(incidents.projectId, opts.projectId));
	}
	// Team scoping. An incident with no project (an uptime flip on a domain, a
	// platform alert) is org-level and stays visible: it names a host, not a
	// tenant's service.
	const scoped = projectIdFilter(incidents.projectId);
	if (scoped) {
		conditions.push(or(isNull(incidents.projectId), scoped) as NonNullable<ReturnType<typeof or>>);
	}
	return db.query.incidents.findMany({
		where: and(...conditions),
		orderBy: [desc(incidents.createdAt)],
		limit,
	});
}

/** Load one incident, scoped to the caller's organization. */
async function findIncident(incidentId: string, organizationId: string) {
	const row = await db.query.incidents.findFirst({
		where: and(eq(incidents.incidentId, incidentId), eq(incidents.organizationId, organizationId)),
	});
	if (!row) throw notFound("Incident not found");
	return row;
}

/**
 * Acknowledge an incident: someone is looking at it. The row stays OPEN
 * (`resolvedAt` untouched) — acknowledging is the "seen it" signal, resolving
 * is the "fixed it" one, and conflating them loses the distinction the
 * timeline is for.
 */
export async function acknowledgeIncident(input: {
	incidentId: string;
	organizationId: string;
	userId: string;
}) {
	const existing = await findIncident(input.incidentId, input.organizationId);
	// Idempotent: re-acknowledging keeps the first acknowledger and time.
	if (existing.acknowledgedAt) return existing;
	const [row] = await db
		.update(incidents)
		.set({ acknowledgedAt: new Date(), acknowledgedBy: input.userId })
		.where(eq(incidents.incidentId, existing.incidentId))
		.returning();
	return row ?? existing;
}

/**
 * Resolve an incident. An optional note is kept in `metadata.resolutionNote`
 * — never in `title`, which the public status page renders.
 */
export async function resolveIncident(input: {
	incidentId: string;
	organizationId: string;
	userId: string;
	note?: string | null;
}) {
	const existing = await findIncident(input.incidentId, input.organizationId);
	if (existing.resolvedAt) return existing;
	const metadata = {
		...(existing.metadata ?? {}),
		...(input.note?.trim()
			? { resolutionNote: input.note.trim(), resolvedBy: input.userId }
			: { resolvedBy: input.userId }),
	};
	const [row] = await db
		.update(incidents)
		.set({
			resolvedAt: new Date(),
			// Resolving without acknowledging first still records who saw it.
			acknowledgedAt: existing.acknowledgedAt ?? new Date(),
			acknowledgedBy: existing.acknowledgedBy ?? input.userId,
			metadata,
		})
		.where(eq(incidents.incidentId, existing.incidentId))
		.returning();
	return row ?? existing;
}

export async function listAlertRules(
	organizationId: string,
	opts: { applicationId?: string; composeId?: string } = {},
) {
	const conditions = [eq(alertRules.organizationId, organizationId)];
	if (opts.applicationId) conditions.push(eq(alertRules.applicationId, opts.applicationId));
	if (opts.composeId) conditions.push(eq(alertRules.composeId, opts.composeId));
	return db.query.alertRules.findMany({
		where: and(...conditions),
		orderBy: [desc(alertRules.createdAt)],
	});
}

export async function upsertAlertRule(input: {
	organizationId: string;
	applicationId?: string | null;
	composeId?: string | null;
	metric: string;
	threshold: number;
	enabled?: boolean;
	cooldownMinutes?: number;
	alertRuleId?: string;
}) {
	if (input.alertRuleId) {
		const [row] = await db
			.update(alertRules)
			.set({
				metric: input.metric,
				threshold: input.threshold,
				enabled: input.enabled ?? true,
				cooldownMinutes: input.cooldownMinutes ?? 30,
			})
			.where(
				and(
					eq(alertRules.alertRuleId, input.alertRuleId),
					eq(alertRules.organizationId, input.organizationId),
				),
			)
			.returning();
		if (!row) {
			throw notFound("Alert rule not found");
		}
		return row;
	}
	const [row] = await db
		.insert(alertRules)
		.values({
			organizationId: input.organizationId,
			applicationId: input.applicationId ?? null,
			composeId: input.composeId ?? null,
			metric: input.metric,
			threshold: input.threshold,
			enabled: input.enabled ?? true,
			cooldownMinutes: input.cooldownMinutes ?? 30,
		})
		.returning();
	if (!row) {
		throw new Error("Failed to create alert rule");
	}
	return row;
}

export async function deleteAlertRule(alertRuleId: string, organizationId: string) {
	await db
		.delete(alertRules)
		.where(
			and(eq(alertRules.alertRuleId, alertRuleId), eq(alertRules.organizationId, organizationId)),
		);
}

/** Metrics an alert rule can watch (mirrors the router's `metricSchema`). */
export const ALERT_RULE_METRICS = ["cpu", "memory", "restarts", "deploy_failure_streak"] as const;
export type AlertRuleMetric = (typeof ALERT_RULE_METRICS)[number];

/**
 * Distinct metrics used by enabled alert rules, so the metrics-history pass
 * only pays for restart counting / deploy-streak queries when a rule needs them.
 */
export async function requiredAlertMetrics(): Promise<Set<AlertRuleMetric>> {
	const rows = await db
		.selectDistinct({ metric: alertRules.metric })
		.from(alertRules)
		.where(eq(alertRules.enabled, true));
	return new Set(
		rows
			.map((row) => row.metric)
			.filter((metric): metric is AlertRuleMetric =>
				(ALERT_RULE_METRICS as readonly string[]).includes(metric),
			),
	);
}

/** Key of the deploy-failure-streak map for a service. */
export const deployStreakKey = (service: {
	applicationId?: string | null;
	composeId?: string | null;
}): string | null =>
	service.applicationId
		? `application:${service.applicationId}`
		: service.composeId
			? `compose:${service.composeId}`
			: null;

export type AlertRuleRow = typeof alertRules.$inferSelect;

/**
 * Every enabled alert rule, indexed by {@link deployStreakKey}. The metrics
 * cron used to run one `alertRules.findMany` **per sampled service, per
 * pass** (audit #3): 100 services meant 100 queries every 30 s for a table
 * that usually holds a handful of rows. Loaded once per pass instead and
 * handed to {@link evaluateServiceAlertRules} as `rules`.
 */
export async function loadEnabledAlertRules(): Promise<Map<string, AlertRuleRow[]>> {
	const rows = await db.query.alertRules.findMany({ where: eq(alertRules.enabled, true) });
	const byService = new Map<string, AlertRuleRow[]>();
	for (const rule of rows) {
		const key = deployStreakKey(rule);
		if (!key) continue;
		byService.set(key, [...(byService.get(key) ?? []), rule]);
	}
	return byService;
}

const DEPLOY_STREAK_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DEPLOY_STREAK_MAX_ROWS = 5000;

/**
 * Consecutive failed deployments per service, newest first: the streak ends
 * at the first successful deployment (in-flight ones are ignored). Schedule
 * runs share the deployments table and are excluded. One query per pass.
 */
export async function computeDeployFailureStreaks(): Promise<Map<string, number>> {
	const rows = await db
		.select({
			applicationId: deployments.applicationId,
			composeId: deployments.composeId,
			status: deployments.status,
		})
		.from(deployments)
		.where(
			and(
				isNull(deployments.scheduleId),
				gt(deployments.createdAt, new Date(Date.now() - DEPLOY_STREAK_LOOKBACK_MS)),
			),
		)
		.orderBy(desc(deployments.createdAt))
		.limit(DEPLOY_STREAK_MAX_ROWS);

	const streaks = new Map<string, number>();
	const closed = new Set<string>();
	for (const row of rows) {
		const key = deployStreakKey(row);
		if (!key || closed.has(key)) continue;
		if (row.status === "error") {
			streaks.set(key, (streaks.get(key) ?? 0) + 1);
		} else if (row.status === "done") {
			closed.add(key);
			if (!streaks.has(key)) streaks.set(key, 0);
		}
	}
	return streaks;
}

/**
 * Evaluate per-service alert rules against a metrics sample.
 * Called from the metrics-history cron alongside org-wide thresholds. A
 * metric the caller did not measure (`undefined`/`null`) skips its rules —
 * the caller is responsible for feeding every metric a rule can reference
 * (see metrics-history: `restarts` from docker, `deployFailureStreak` from
 * {@link computeDeployFailureStreaks}).
 */
export async function evaluateServiceAlertRules(input: {
	organizationId: string;
	projectId?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
	appName: string;
	cpu?: number | null;
	memoryPercent?: number | null;
	restarts?: number | null;
	deployFailureStreak?: number | null;
	/**
	 * Pre-loaded rules for THIS service ({@link loadEnabledAlertRules}). Pass
	 * it from a batch caller (the metrics cron) to skip the per-service query;
	 * omit it for one-off callers.
	 */
	rules?: AlertRuleRow[];
}): Promise<void> {
	if (!input.applicationId && !input.composeId) return;

	const rules =
		input.rules ??
		(await (async () => {
			const conditions = [
				eq(alertRules.organizationId, input.organizationId),
				eq(alertRules.enabled, true),
				input.applicationId
					? eq(alertRules.applicationId, input.applicationId)
					: eq(alertRules.composeId, input.composeId as string),
			];
			return await db.query.alertRules.findMany({ where: and(...conditions) });
		})());
	if (rules.length === 0) return;
	const now = Date.now();

	for (const rule of rules) {
		// A pre-loaded batch is not org-filtered by the query: keep the tenant
		// check here so a caller can never evaluate another org's rule.
		if (rule.organizationId !== input.organizationId) continue;
		if (rule.enabled !== true) continue;
		let value: number | null = null;
		if (rule.metric === "cpu") value = input.cpu ?? null;
		else if (rule.metric === "memory") value = input.memoryPercent ?? null;
		else if (rule.metric === "restarts") value = input.restarts ?? null;
		else if (rule.metric === "deploy_failure_streak") value = input.deployFailureStreak ?? null;
		if (value === null || value < rule.threshold) continue;

		const cooldownMs = rule.cooldownMinutes * 60_000;
		if (rule.lastTriggeredAt && now - rule.lastTriggeredAt.getTime() < cooldownMs) continue;

		await db
			.update(alertRules)
			.set({ lastTriggeredAt: new Date() })
			.where(eq(alertRules.alertRuleId, rule.alertRuleId));

		const title = `${rule.metric} alert on ${input.appName}`;
		const message = `Service "${input.appName}" ${rule.metric}=${value.toFixed(1)} exceeded threshold ${rule.threshold}.`;

		await recordIncident({
			organizationId: input.organizationId,
			projectId: input.projectId,
			kind: "alert_rule",
			severity: "warning",
			title,
			message,
			serviceId: input.applicationId ?? input.composeId,
			serviceName: input.appName,
			metadata: { metric: rule.metric, value, threshold: rule.threshold },
		});

		await notifyEvent(input.organizationId, "serviceAlert", {
			title,
			message,
			fields: [
				{ name: "Service", value: input.appName },
				{ name: "Metric", value: rule.metric },
				{ name: "Value", value: value.toFixed(1) },
				{ name: "Threshold", value: String(rule.threshold) },
			],
		});
	}
}

const MAX_LOG_BYTES = 50 * 1024 * 1024; // ~50MB org-wide soft cap

export async function ingestServiceLog(input: {
	organizationId: string;
	serviceId: string;
	serviceType: "application" | "compose";
	deploymentId?: string | null;
	body: string;
}): Promise<void> {
	const body = input.body.slice(-200_000);
	if (!body.trim()) return;

	await db.insert(serviceLogs).values({
		organizationId: input.organizationId,
		serviceId: input.serviceId,
		serviceType: input.serviceType,
		deploymentId: input.deploymentId ?? null,
		body,
		searchVector: sql`to_tsvector('english', ${body})`,
	});

	// Soft prune: drop oldest when over size budget (approx by row count * avg).
	const sizeRows = await db
		.select({
			total: sql<number>`coalesce(sum(length(${serviceLogs.body})), 0)`,
		})
		.from(serviceLogs)
		.where(eq(serviceLogs.organizationId, input.organizationId));
	const total = Number(sizeRows[0]?.total ?? 0);
	if (total > MAX_LOG_BYTES) {
		await db.execute(sql`
			DELETE FROM service_log
			WHERE service_log_id IN (
				SELECT service_log_id FROM service_log
				WHERE organization_id = ${input.organizationId}
				ORDER BY created_at ASC
				LIMIT 20
			)
		`);
	}
}

export async function searchServiceLogs(
	organizationId: string,
	opts: { query: string; serviceId?: string; limit?: number },
) {
	const limit = opts.limit ?? 40;
	const q = opts.query.trim();
	if (!q) return [];

	const conditions = [eq(serviceLogs.organizationId, organizationId)];
	if (opts.serviceId) conditions.push(eq(serviceLogs.serviceId, opts.serviceId));

	// Prefer tsvector; fall back to ILIKE if vector is null on older rows.
	return db
		.select({
			serviceLogId: serviceLogs.serviceLogId,
			serviceId: serviceLogs.serviceId,
			serviceType: serviceLogs.serviceType,
			deploymentId: serviceLogs.deploymentId,
			body: serviceLogs.body,
			createdAt: serviceLogs.createdAt,
			rank: sql<number>`ts_rank(${serviceLogs.searchVector}, plainto_tsquery('english', ${q}))`,
		})
		.from(serviceLogs)
		.where(
			and(
				...conditions,
				or(
					sql`${serviceLogs.searchVector} @@ plainto_tsquery('english', ${q})`,
					ilike(serviceLogs.body, `%${q}%`),
				),
			),
		)
		.orderBy(desc(sql`ts_rank(${serviceLogs.searchVector}, plainto_tsquery('english', ${q}))`))
		.limit(limit);
}

export async function listUptimeProbes(organizationId: string) {
	return db.query.uptimeProbes.findMany({
		where: eq(uptimeProbes.organizationId, organizationId),
		with: { domain: true },
		orderBy: [desc(uptimeProbes.createdAt)],
	});
}

/** Default cap on uptime probes per organization (`NIXPLOY_MAX_PROBES_PER_ORG`). */
export const DEFAULT_MAX_PROBES_PER_ORG = 50;

/** Resolve the per-org probe cap; `0` disables the cap. */
export function maxProbesPerOrg(raw = process.env.NIXPLOY_MAX_PROBES_PER_ORG): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_PROBES_PER_ORG;
	return parsed;
}

export async function setUptimeProbe(input: {
	organizationId: string;
	domainId: string;
	enabled: boolean;
	path?: string;
	expectedStatus?: number;
	intervalSeconds?: number;
	/** Caller, for the capability gate. */
	actorUserId: string;
}) {
	// Probes are outbound requests from the panel's IP with a status-code
	// read-back, so they belong to whoever owns the domains — not to every
	// `project.write` holder — and they are capped (security audit 2.6).
	await assertCapability(input.actorUserId, input.organizationId, "domains.manage");
	const existing = await db.query.uptimeProbes.findFirst({
		where: and(
			eq(uptimeProbes.domainId, input.domainId),
			eq(uptimeProbes.organizationId, input.organizationId),
		),
	});
	if (existing) {
		const [row] = await db
			.update(uptimeProbes)
			.set({
				enabled: input.enabled,
				path: input.path ?? existing.path,
				expectedStatus: input.expectedStatus ?? existing.expectedStatus,
				intervalSeconds: input.intervalSeconds ?? existing.intervalSeconds,
			})
			.where(eq(uptimeProbes.uptimeProbeId, existing.uptimeProbeId))
			.returning();
		return row;
	}
	const cap = maxProbesPerOrg();
	if (cap > 0) {
		const [existingCount] = await db
			.select({ value: count() })
			.from(uptimeProbes)
			.where(eq(uptimeProbes.organizationId, input.organizationId));
		if ((existingCount?.value ?? 0) >= cap) {
			throw badRequest(
				`This organization already has ${cap} uptime probes (NIXPLOY_MAX_PROBES_PER_ORG). Remove one before adding another.`,
			);
		}
	}
	const [row] = await db
		.insert(uptimeProbes)
		.values({
			organizationId: input.organizationId,
			domainId: input.domainId,
			enabled: input.enabled,
			path: input.path ?? "/",
			expectedStatus: input.expectedStatus ?? 200,
			intervalSeconds: input.intervalSeconds ?? 60,
		})
		.returning();
	return row;
}

/** Max probes checked in parallel — serial probes blow the 30s cron budget. */
const UPTIME_PROBE_CONCURRENCY = 5;

type UptimeProbeWithDomain = typeof uptimeProbes.$inferSelect & {
	domain: { host: string; https: boolean } | null;
};

async function runOneProbe(probe: UptimeProbeWithDomain): Promise<void> {
	const domain = probe.domain;
	const host = domain?.host;
	if (!domain || !host) return;
	const scheme = domain.https ? "https" : "http";
	const path = probe.path.startsWith("/") ? probe.path : `/${probe.path}`;
	const url = `${scheme}://${host}${path}`;
	let target: Awaited<ReturnType<typeof assertSafeOutboundUrl>>;
	try {
		target = await assertSafeOutboundUrl(url, { allowHttp: !domain.https });
	} catch {
		await db
			.update(uptimeProbes)
			.set({
				lastCheckedAt: new Date(),
				status: "down",
				lastStatusChangeAt: new Date(),
				lastError: "Probe host is not allowed (private/link-local/metadata)",
			})
			.where(eq(uptimeProbes.uptimeProbeId, probe.uptimeProbeId));
		return;
	}

	let nextStatus: "up" | "down" = "down";
	let lastError: string | null = null;
	try {
		// Pinned to the address the guard vetted: a probe host with a 0-TTL
		// record cannot re-point at the overlay between check and connect.
		const res = await pinnedFetch(target, {
			method: "GET",
			headers: { "user-agent": "nixploy-uptime/1.0" },
			timeoutMs: probe.timeoutMs,
			maxBytes: 8 * 1024,
		});
		nextStatus = res.status === probe.expectedStatus ? "up" : "down";
		if (nextStatus === "down") {
			lastError = `HTTP ${res.status} (expected ${probe.expectedStatus})`;
		}
	} catch (error) {
		nextStatus = "down";
		lastError = error instanceof Error ? error.message : String(error);
	}

	const flipped = probe.status !== "unknown" && probe.status !== nextStatus;
	await db
		.update(uptimeProbes)
		.set({
			status: nextStatus,
			lastCheckedAt: new Date(),
			lastError,
			...(flipped || probe.status === "unknown" ? { lastStatusChangeAt: new Date() } : {}),
		})
		.where(eq(uptimeProbes.uptimeProbeId, probe.uptimeProbeId));

	if (flipped) {
		const title = `Uptime ${nextStatus}: ${host}`;
		const message =
			nextStatus === "down"
				? `Probe for ${url} is down: ${lastError ?? "unknown error"}`
				: `Probe for ${url} recovered.`;
		await recordIncident({
			organizationId: probe.organizationId,
			kind: "uptime",
			severity: nextStatus === "down" ? "critical" : "info",
			title,
			message,
			serviceName: host,
			metadata: { url, status: nextStatus },
		});
		await notifyEvent(probe.organizationId, "uptimeFlip", {
			title,
			message,
			fields: [
				{ name: "Host", value: host },
				{ name: "Status", value: nextStatus },
			],
		});
	}
}

export async function runUptimeProbes(): Promise<void> {
	const probes = await db.query.uptimeProbes.findMany({
		where: and(eq(uptimeProbes.enabled, true)),
		with: { domain: true },
	});
	const now = Date.now();
	const due = probes.filter(
		(probe) => now - (probe.lastCheckedAt?.getTime() ?? 0) >= probe.intervalSeconds * 1000,
	);

	// Bounded concurrency: one slow/broken probe must not stall the pass.
	for (let i = 0; i < due.length; i += UPTIME_PROBE_CONCURRENCY) {
		await Promise.all(
			due.slice(i, i + UPTIME_PROBE_CONCURRENCY).map((probe) =>
				runOneProbe(probe).catch((error) => {
					console.error(`uptime probe ${probe.uptimeProbeId} failed:`, error);
				}),
			),
		);
	}
}

export async function initUptimeProbes(): Promise<void> {
	const schedule = (await import("node-schedule")).default;
	let inFlight = false;
	schedule.scheduleJob("uptime-probes", "*/30 * * * * *", () => {
		if (inFlight) return; // never overlap passes
		inFlight = true;
		void runUptimeProbes()
			.catch((error) => {
				console.error("uptime probes failed:", error);
			})
			.finally(() => {
				inFlight = false;
			});
	});
}
