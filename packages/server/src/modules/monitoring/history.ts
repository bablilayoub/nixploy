import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { environments, webServerSettings } from "../../db/schema";
import { resolveLocalContainer } from "../../ws/docker";
import { mapDockerStats } from "../../ws/docker-stats";
import { getConfigDir } from "../application/paths";
import { notifyEvent } from "../notifications";

/**
 * Metrics history: a lightweight per-service ring buffer on disk. Every 30s
 * a cron snapshots cpu/memory/network for each running local service into
 * `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`, pruned to 48h. Remote
 * (managed-server) services are not sampled — their stats require an SSH
 * round-trip per service and are only available live via /ws/stats.
 */

export const METRICS_RETENTION_MS = 48 * 60 * 60 * 1000;

// ── threshold alerts ────────────────────────────────────────────────────────
// Org-level CPU/memory thresholds (Settings → Web Server). When a service's
// rolling average over ALERT_WINDOW samples crosses a threshold, a
// `serverThreshold` notification fires (once per ALERT_COOLDOWN_MS per
// service + metric).

const ALERT_WINDOW = 5; // ~2.5 min at 30s sampling
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const alertWindows = new Map<string, { cpu: number; memPercent: number }[]>();
const alertCooldowns = new Map<string, number>();

interface AlertThresholds {
	cpu: number | null;
	memory: number | null;
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

async function evaluateAlerts(
	appName: string,
	environmentId: string,
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

	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	const organizationId = environment?.project.organizationId;
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
const SAMPLE_CRON = "*/30 * * * * *";
const MAX_POINTS_PER_READ = 240;

interface HistoryPoint {
	t: number;
	cpu: number;
	mu: number; // memory used, bytes
	mt: number; // memory total, bytes
	rx: number; // cumulative network rx, bytes
	tx: number; // cumulative network tx, bytes
	br?: number; // cumulative block read, bytes (absent in older points)
	bw?: number; // cumulative block write, bytes
	pids?: number;
}

export interface HistorySample {
	t: number;
	cpu: number;
	memoryUsed: number;
	memoryTotal: number;
	rx: number;
	tx: number;
	blockRead: number;
	blockWrite: number;
	pids: number;
}

const metricsDir = () => path.join(getConfigDir(), "metrics");
const metricsFile = (appName: string) => path.join(metricsDir(), `${appName}.jsonl`);

async function appendPoints(appName: string, point: HistoryPoint): Promise<void> {
	const file = metricsFile(appName);
	let existing: HistoryPoint[] = [];
	try {
		existing = (await readFile(file, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as HistoryPoint);
	} catch {
		// No history yet (or unreadable) — start fresh.
	}
	const cutoff = Date.now() - METRICS_RETENTION_MS;
	const kept = existing.filter((entry) => entry.t >= cutoff);
	kept.push(point);
	await mkdir(metricsDir(), { recursive: true });
	await writeFile(file, `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

/** One sampling pass over every local application, compose and database service. */
export async function sampleAllServices(): Promise<void> {
	const [apps, composeRows, pg, my, maria, mongoRows, redisRows] = await Promise.all([
		db.query.applications.findMany({
			columns: {
				applicationId: true,
				appName: true,
				serverId: true,
				environmentId: true,
			},
		}),
		// Compose: the first running container of the stack (partial but useful).
		db.query.compose.findMany({
			columns: { composeId: true, appName: true, serverId: true, environmentId: true },
		}),
		db.query.postgres.findMany({
			columns: { appName: true, serverId: true, environmentId: true },
		}),
		db.query.mysql.findMany({
			columns: { appName: true, serverId: true, environmentId: true },
		}),
		db.query.mariadb.findMany({
			columns: { appName: true, serverId: true, environmentId: true },
		}),
		db.query.mongo.findMany({
			columns: { appName: true, serverId: true, environmentId: true },
		}),
		db.query.redis.findMany({
			columns: { appName: true, serverId: true, environmentId: true },
		}),
	]);
	const targets = [
		...apps.map((row) => ({ ...row, kind: "application" as const })),
		...composeRows.map((row) => ({ ...row, kind: "compose" as const })),
		...pg.map((row) => ({ ...row, kind: "other" as const })),
		...my.map((row) => ({ ...row, kind: "other" as const })),
		...maria.map((row) => ({ ...row, kind: "other" as const })),
		...mongoRows.map((row) => ({ ...row, kind: "other" as const })),
		...redisRows.map((row) => ({ ...row, kind: "other" as const })),
	].filter(
		(row) => !row.serverId, // local only (see module doc)
	);
	const thresholds = await readThresholds();

	const now = Date.now();
	for (const target of targets) {
		const appName = target.appName;
		try {
			const container = await resolveLocalContainer(appName);
			if (!container) continue; // not running — no samples, no noise
			const stats = await container.stats({ stream: false });
			const frame = mapDockerStats(stats);
			await evaluateAlerts(appName, target.environmentId, frame, thresholds);

			if (target.kind === "application" || target.kind === "compose") {
				const environment = await db.query.environments.findFirst({
					where: eq(environments.environmentId, target.environmentId),
					with: { project: true },
				});
				if (environment?.project.organizationId) {
					const { evaluateServiceAlertRules } = await import("../observability");
					await evaluateServiceAlertRules({
						organizationId: environment.project.organizationId,
						projectId: environment.project.projectId,
						applicationId:
							target.kind === "application" && "applicationId" in target
								? target.applicationId
								: null,
						composeId: target.kind === "compose" && "composeId" in target ? target.composeId : null,
						appName,
						cpu: frame.cpu,
						memoryPercent: frame.memory.percent,
					});
				}
			}

			await appendPoints(appName, {
				t: now,
				cpu: frame.cpu,
				mu: frame.memory.used,
				mt: frame.memory.total,
				rx: frame.network.rx,
				tx: frame.network.tx,
				br: frame.block.read,
				bw: frame.block.write,
				pids: frame.pids,
			});
		} catch {
			// Container racing a restart or stats hiccup — skip this pass.
		}
	}
}

/**
 * Read the last `hours` of history for a service, downsampled to at most
 * MAX_POINTS_PER_READ points (uniform stride).
 */
export async function readMetricsHistory(appName: string, hours: number): Promise<HistorySample[]> {
	let points: HistoryPoint[] = [];
	try {
		points = (await readFile(metricsFile(appName), "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as HistoryPoint);
	} catch {
		return [];
	}
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	const windowed = points.filter((point) => point.t >= cutoff);
	if (windowed.length <= MAX_POINTS_PER_READ) {
		return windowed.map(toSample);
	}
	const stride = windowed.length / MAX_POINTS_PER_READ;
	const sampled: HistoryPoint[] = [];
	for (let index = 0; index < MAX_POINTS_PER_READ; index++) {
		const point = windowed[Math.floor(index * stride)];
		if (point) sampled.push(point);
	}
	return sampled.map(toSample);
}

const toSample = (point: HistoryPoint): HistorySample => ({
	t: point.t,
	cpu: point.cpu,
	memoryUsed: point.mu,
	memoryTotal: point.mt,
	rx: point.rx,
	tx: point.tx,
	blockRead: point.br ?? 0,
	blockWrite: point.bw ?? 0,
	pids: point.pids ?? 0,
});

let started = false;
let inFlight = false;

/** Register the 30s metrics-history cron (boot, apps/web server.ts). */
export function initMetricsHistory(): void {
	if (started) return; // tsx watch / HMR re-invocations must not double-register
	started = true;
	schedule.scheduleJob("metrics-history", SAMPLE_CRON, async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await sampleAllServices();
		} catch (error) {
			console.error("Metrics history pass failed:", error);
		} finally {
			inFlight = false;
		}
	});
}
