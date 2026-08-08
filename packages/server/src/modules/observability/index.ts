import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { alertRules, incidents, serviceLogs, uptimeProbes } from "../../db/schema";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import { notifyEvent } from "../notifications";

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
	return db.query.incidents.findMany({
		where: and(...conditions),
		orderBy: [desc(incidents.createdAt)],
		limit,
	});
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
			throw new Error("Alert rule not found");
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

/**
 * Evaluate per-service alert rules against a metrics sample.
 * Called from the metrics-history cron alongside org-wide thresholds.
 */
export async function evaluateServiceAlertRules(input: {
	organizationId: string;
	projectId?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
	appName: string;
	cpu: number;
	memoryPercent: number;
	restarts?: number;
	deployFailureStreak?: number;
}): Promise<void> {
	const conditions = [
		eq(alertRules.organizationId, input.organizationId),
		eq(alertRules.enabled, true),
	];
	if (input.applicationId) {
		conditions.push(eq(alertRules.applicationId, input.applicationId));
	} else if (input.composeId) {
		conditions.push(eq(alertRules.composeId, input.composeId));
	} else {
		return;
	}

	const rules = await db.query.alertRules.findMany({ where: and(...conditions) });
	const now = Date.now();

	for (const rule of rules) {
		let value: number | null = null;
		if (rule.metric === "cpu") value = input.cpu;
		else if (rule.metric === "memory") value = input.memoryPercent;
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
		.select({ total: sql<number>`coalesce(sum(length(${serviceLogs.body})), 0)` })
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

export async function setUptimeProbe(input: {
	organizationId: string;
	domainId: string;
	enabled: boolean;
	path?: string;
	expectedStatus?: number;
	intervalSeconds?: number;
}) {
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

export async function runUptimeProbes(): Promise<void> {
	const probes = await db.query.uptimeProbes.findMany({
		where: and(eq(uptimeProbes.enabled, true)),
		with: { domain: true },
	});
	const now = Date.now();

	for (const probe of probes) {
		const last = probe.lastCheckedAt?.getTime() ?? 0;
		if (now - last < probe.intervalSeconds * 1000) continue;

		const host = probe.domain?.host;
		if (!host) continue;
		const scheme = probe.domain.https ? "https" : "http";
		const path = probe.path.startsWith("/") ? probe.path : `/${probe.path}`;
		const url = `${scheme}://${host}${path}`;
		try {
			await assertSafeOutboundUrl(url, { allowHttp: !probe.domain.https });
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
			continue;
		}

		let nextStatus: "up" | "down" = "down";
		let lastError: string | null = null;
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), probe.timeoutMs);
			const res = await fetch(url, {
				method: "GET",
				redirect: "error",
				signal: controller.signal,
				headers: { "user-agent": "nixploy-uptime/1.0" },
			});
			clearTimeout(timer);
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
}

export async function initUptimeProbes(): Promise<void> {
	const schedule = (await import("node-schedule")).default;
	schedule.scheduleJob("uptime-probes", "*/30 * * * * *", () => {
		void runUptimeProbes().catch((error) => {
			console.error("uptime probes failed:", error);
		});
	});
}
