import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { environments, webServerSettings } from "../../db/schema";
import { notifyEvent } from "../notifications";
import type { AlertRuleRow } from "../observability";

/**
 * Alerting side of the metrics pass (`./sampler.ts`):
 *
 * - org-level CPU/memory thresholds (Settings → Platform). When a service's
 *   rolling average over {@link ALERT_WINDOW} samples crosses a threshold, a
 *   `serverThreshold` notification fires (once per {@link ALERT_COOLDOWN_MS}
 *   per service + metric);
 * - per-service alert rules (`modules/observability`), evaluated against the
 *   same frame.
 *
 * Everything one pass needs from the database is loaded once into a
 * {@link PassContext} — never per sampled service (audit #3).
 */

const ALERT_WINDOW = 5; // ~2.5 min at 30s sampling
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const alertWindows = new Map<string, { cpu: number; memPercent: number }[]>();
const alertCooldowns = new Map<string, number>();

export interface AlertThresholds {
	cpu: number | null;
	memory: number | null;
}

/** One service the pass samples (an application, a compose stack or a database). */
export interface SampleTarget {
	appName: string;
	environmentId: string;
	serverId: string | null;
	kind: "application" | "compose" | "other";
	applicationId?: string;
	composeId?: string;
}

/** One normalized metrics frame, whether it came from dockerode or SSH. */
export interface ServiceFrame {
	cpu: number;
	memory: { used: number; total: number; percent: number };
	network: { rx: number; tx: number };
	block: { read: number; write: number };
	pids: number;
}

/** Per-pass inputs shared by every target: one query each, never per service. */
export interface PassContext {
	thresholds: AlertThresholds;
	/** Enabled alert rules reference `restarts` — count crashed tasks per service. */
	wantRestarts: boolean;
	/** `deploy_failure_streak` rules exist — streaks computed once per pass. */
	deployStreaks: Map<string, number> | null;
	/** environmentId → { organizationId, projectId }, one `inArray` query. */
	owners: Map<string, { organizationId: string; projectId: string }>;
	/** Enabled alert rules keyed by `application:<id>` / `compose:<id>`. */
	rulesByService: Map<string, AlertRuleRow[]>;
}

async function readThresholds(): Promise<AlertThresholds> {
	const [row] = await db.select().from(webServerSettings).limit(1);
	const extras =
		typeof row?.metricsConfig === "object" && row.metricsConfig !== null
			? ((row.metricsConfig as Record<string, unknown>).webServer as
					| Record<string, unknown>
					| undefined)
			: undefined;
	const cpu = extras?.cpuAlertPercent;
	const memory = extras?.memoryAlertPercent;
	return {
		cpu: typeof cpu === "number" && cpu > 0 ? cpu : null,
		memory: typeof memory === "number" && memory > 0 ? memory : null,
	};
}

export async function loadPassContext(targets: SampleTarget[]): Promise<PassContext> {
	const { requiredAlertMetrics, computeDeployFailureStreaks, loadEnabledAlertRules } = await import(
		"../observability"
	);
	const environmentIds = [...new Set(targets.map((target) => target.environmentId))];
	const [thresholds, metrics, environmentRows, rulesByService] = await Promise.all([
		readThresholds(),
		requiredAlertMetrics(),
		// One query for every service's org/project — this used to be one
		// `environments.findFirst` per target per pass (audit #3).
		environmentIds.length > 0
			? db.query.environments.findMany({
					where: inArray(environments.environmentId, environmentIds),
					with: { project: true },
				})
			: Promise.resolve([]),
		loadEnabledAlertRules(),
	]);
	return {
		thresholds,
		wantRestarts: metrics.has("restarts"),
		deployStreaks: metrics.has("deploy_failure_streak")
			? await computeDeployFailureStreaks()
			: null,
		owners: new Map(
			environmentRows.map((row) => [
				row.environmentId,
				{ organizationId: row.project.organizationId, projectId: row.project.projectId },
			]),
		),
		rulesByService,
	};
}

/** Org-wide CPU/memory thresholds over a rolling window, with a per-metric cooldown. */
export async function evaluateAlerts(
	appName: string,
	organizationId: string | null,
	frame: { cpu: number; memory: { percent: number } },
	thresholds: AlertThresholds,
): Promise<void> {
	if (!thresholds.cpu && !thresholds.memory) return;
	const window = [
		...(alertWindows.get(appName) ?? []),
		{ cpu: frame.cpu, memPercent: frame.memory.percent },
	].slice(-ALERT_WINDOW);
	alertWindows.set(appName, window);
	if (window.length < ALERT_WINDOW) return; // sustained load only

	const avgCpu = window.reduce((sum, p) => sum + p.cpu, 0) / window.length;
	const avgMem = window.reduce((sum, p) => sum + p.memPercent, 0) / window.length;

	const crossed: { metric: "CPU" | "memory"; avg: number; threshold: number }[] = [];
	if (thresholds.cpu && avgCpu > thresholds.cpu) {
		crossed.push({ metric: "CPU", avg: avgCpu, threshold: thresholds.cpu });
	}
	if (thresholds.memory && avgMem > thresholds.memory) {
		crossed.push({ metric: "memory", avg: avgMem, threshold: thresholds.memory });
	}
	if (crossed.length === 0) return;

	const now = Date.now();
	const pending = crossed.filter(
		({ metric }) => now - (alertCooldowns.get(`${appName}:${metric}`) ?? 0) > ALERT_COOLDOWN_MS,
	);
	if (pending.length === 0) return;

	if (!organizationId) return;

	for (const { metric, avg, threshold } of pending) {
		alertCooldowns.set(`${appName}:${metric}`, now);
		await notifyEvent(organizationId, "serverThreshold", {
			title: `High ${metric} on ${appName}`,
			message: `Service "${appName}" averaged ${avg.toFixed(1)}% ${metric} over the last ${ALERT_WINDOW} samples (threshold ${threshold}%).`,
			fields: [
				{ name: "Service", value: appName },
				{ name: "Metric", value: metric },
				{ name: "Average", value: `${avg.toFixed(1)}%` },
				{ name: "Threshold", value: `${threshold}%` },
			],
		});
	}
}

/** Per-service alert rules (observability) for application/compose targets. */
export async function evaluateRules(
	target: SampleTarget,
	appName: string,
	metrics: { cpu?: number; memoryPercent?: number; restarts?: number | null },
	context: PassContext,
): Promise<void> {
	if (target.kind !== "application" && target.kind !== "compose") return;
	const owner = context.owners.get(target.environmentId);
	if (!owner) return;
	const { evaluateServiceAlertRules, deployStreakKey } = await import("../observability");
	const applicationId = target.kind === "application" ? (target.applicationId ?? null) : null;
	const composeId = target.kind === "compose" ? (target.composeId ?? null) : null;
	const streakKey = deployStreakKey({ applicationId, composeId });
	const rules = streakKey ? (context.rulesByService.get(streakKey) ?? []) : [];
	if (rules.length === 0) return;
	await evaluateServiceAlertRules({
		organizationId: owner.organizationId,
		projectId: owner.projectId,
		applicationId,
		composeId,
		appName,
		cpu: metrics.cpu,
		memoryPercent: metrics.memoryPercent,
		restarts: metrics.restarts,
		deployFailureStreak:
			context.deployStreaks && streakKey ? (context.deployStreaks.get(streakKey) ?? 0) : null,
		rules,
	});
}
