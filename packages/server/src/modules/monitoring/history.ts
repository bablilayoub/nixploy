import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { environments, servers, webServerSettings } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { execAsyncRemote } from "../../utils/exec";
import { resolveLocalContainer } from "../../ws/docker";
import { mapDockerStats } from "../../ws/docker-stats";
import { getConfigDir } from "../application/paths";
import { getDocker } from "../deployment/docker";
import { notifyEvent } from "../notifications";
import {
	buildRemoteSampleCommand,
	countRecentFailedTasks,
	parseRemoteSampleOutput,
	readServerMetricsConfig,
	remoteSampleTimeoutMs,
} from "./remote";

const log = createLogger("metrics-history");

/**
 * Metrics history: a lightweight per-service ring buffer on disk. Every 30s
 * a cron snapshots cpu/memory/network for each running service into
 * `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`, pruned to 48h.
 *
 * Local services are sampled via dockerode (a few at a time). Remote services
 * (hosted on a managed server) are sampled over one SSH batch per server,
 * servers in parallel — honoring that server's `metricsConfig.metrics`
 * (enabled / intervalSeconds) — alongside a host-level snapshot stored as
 * `server-<serverId>.jsonl`. A failing or unreachable server is skipped
 * without affecting local sampling.
 */

export const METRICS_RETENTION_MS = 48 * 60 * 60 * 1000;

// ── threshold alerts ────────────────────────────────────────────────────────
// Org-level CPU/memory thresholds (Settings → Platform). When a service's
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
/** Host-level history of a managed server lives next to the service files. */
const serverMetricsFile = (serverId: string) => path.join(metricsDir(), `server-${serverId}.jsonl`);

interface ServerHistoryPoint {
	t: number;
	cpu: number; // busy percent over the sample window
	mu: number; // memory used, bytes
	mt: number; // memory total, bytes
	du: number; // disk used (/), bytes
	dt: number; // disk total (/), bytes
}

export interface ServerHistorySample {
	t: number;
	cpuPercent: number;
	memoryUsed: number;
	memoryTotal: number;
	diskUsed: number;
	diskTotal: number;
}

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

async function appendServerPoints(serverId: string, point: ServerHistoryPoint): Promise<void> {
	const file = serverMetricsFile(serverId);
	let existing: ServerHistoryPoint[] = [];
	try {
		existing = (await readFile(file, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ServerHistoryPoint);
	} catch {
		// No history yet (or unreadable) — start fresh.
	}
	const cutoff = Date.now() - METRICS_RETENTION_MS;
	const kept = existing.filter((entry) => entry.t >= cutoff);
	kept.push(point);
	await mkdir(metricsDir(), { recursive: true });
	await writeFile(file, `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

/** One sampling pass over every application, compose and database service. */
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
	const targets: SampleTarget[] = [
		...apps.map((row) => ({ ...row, kind: "application" as const })),
		...composeRows.map((row) => ({ ...row, kind: "compose" as const })),
		...pg.map((row) => ({ ...row, kind: "other" as const })),
		...my.map((row) => ({ ...row, kind: "other" as const })),
		...maria.map((row) => ({ ...row, kind: "other" as const })),
		...mongoRows.map((row) => ({ ...row, kind: "other" as const })),
		...redisRows.map((row) => ({ ...row, kind: "other" as const })),
	];
	const context = await loadPassContext();
	const now = Date.now();

	// Local + every remote server run side by side: an unreachable remote
	// must not delay local sampling, and one slow `docker stats` must not
	// serialize the whole pass past the 30s cadence.
	await Promise.all([
		mapWithConcurrency(
			targets.filter((row) => !row.serverId),
			LOCAL_SAMPLE_CONCURRENCY,
			(target) => sampleLocalTarget(target, context, now),
		),
		sampleRemoteServers(
			targets.filter((row) => row.serverId),
			context,
			now,
		),
	]);
}

/** Max local `docker stats` calls in flight (each blocks ~1-2s). */
const LOCAL_SAMPLE_CONCURRENCY = 4;

async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (index < items.length) {
			const item = items[index++] as T;
			await fn(item);
		}
	});
	await Promise.all(workers);
}

interface SampleTarget {
	appName: string;
	environmentId: string;
	serverId: string | null;
	kind: "application" | "compose" | "other";
	applicationId?: string;
	composeId?: string;
}

interface ServiceFrame {
	cpu: number;
	memory: { used: number; total: number; percent: number };
	network: { rx: number; tx: number };
	block: { read: number; write: number };
	pids: number;
}

/** Per-pass inputs shared by every target: thresholds + which rule metrics need extra work. */
interface PassContext {
	thresholds: AlertThresholds;
	/** Enabled alert rules reference `restarts` — count crashed tasks per service. */
	wantRestarts: boolean;
	/** `deploy_failure_streak` rules exist — streaks computed once per pass. */
	deployStreaks: Map<string, number> | null;
}

async function loadPassContext(): Promise<PassContext> {
	const { requiredAlertMetrics, computeDeployFailureStreaks } = await import("../observability");
	const [thresholds, metrics] = await Promise.all([readThresholds(), requiredAlertMetrics()]);
	return {
		thresholds,
		wantRestarts: metrics.has("restarts"),
		deployStreaks: metrics.has("deploy_failure_streak")
			? await computeDeployFailureStreaks()
			: null,
	};
}

const LOCAL_LABEL_FILTERS = (appName: string) => [
	`com.docker.swarm.service.name=${appName}`,
	`com.docker.compose.project=${appName}`,
	`com.docker.stack.namespace=${appName}`,
];

/**
 * Restart signal for a local service: RestartCount of the running container
 * (in-place restarts, compose `restart:` policies) plus recently crashed task
 * containers (Swarm crash loops never restart in place).
 */
async function countLocalRestarts(
	appName: string,
	container: Awaited<ReturnType<typeof resolveLocalContainer>>,
	now: number,
): Promise<number> {
	let restarts = 0;
	if (container) {
		const info = await container.inspect();
		restarts += info.RestartCount ?? 0;
	}
	const docker = await getDocker();
	for (const label of LOCAL_LABEL_FILTERS(appName)) {
		const exited = await docker.listContainers({
			all: true,
			filters: { label: [label], status: ["exited"] },
		});
		restarts += countRecentFailedTasks(
			exited.map((entry) => ({ createdAt: entry.Created * 1000, status: entry.Status })),
			now,
		);
	}
	return restarts;
}

async function sampleLocalTarget(
	target: SampleTarget,
	context: PassContext,
	now: number,
): Promise<void> {
	const appName = target.appName;
	try {
		const container = await resolveLocalContainer(appName);
		const restarts =
			context.wantRestarts && target.kind !== "other"
				? await countLocalRestarts(appName, container, now)
				: null;
		if (!container) {
			// Not running — no samples, no noise. Crash loops still feed the
			// restart-based rules so "restarts ≥ N" fires without a live container.
			await evaluateRules(target, appName, { restarts }, context);
			return;
		}
		const stats = await container.stats({ stream: false });
		const frame = mapDockerStats(stats);
		await handleFrame(target, appName, frame, context, now, restarts);
	} catch {
		// Container racing a restart or stats hiccup — skip this pass.
	}
}

/** Per-service alert rules (observability) for application/compose targets. */
async function evaluateRules(
	target: SampleTarget,
	appName: string,
	metrics: { cpu?: number; memoryPercent?: number; restarts?: number | null },
	context: PassContext,
): Promise<void> {
	if (target.kind !== "application" && target.kind !== "compose") return;
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, target.environmentId),
		with: { project: true },
	});
	if (!environment?.project.organizationId) return;
	const { evaluateServiceAlertRules, deployStreakKey } = await import("../observability");
	const applicationId = target.kind === "application" ? (target.applicationId ?? null) : null;
	const composeId = target.kind === "compose" ? (target.composeId ?? null) : null;
	const streakKey = deployStreakKey({ applicationId, composeId });
	await evaluateServiceAlertRules({
		organizationId: environment.project.organizationId,
		projectId: environment.project.projectId,
		applicationId,
		composeId,
		appName,
		cpu: metrics.cpu,
		memoryPercent: metrics.memoryPercent,
		restarts: metrics.restarts,
		deployFailureStreak:
			context.deployStreaks && streakKey ? (context.deployStreaks.get(streakKey) ?? 0) : null,
	});
}

/** Alerts + persistence shared by the local and remote sampling paths. */
async function handleFrame(
	target: SampleTarget,
	appName: string,
	frame: ServiceFrame,
	context: PassContext,
	now: number,
	restarts: number | null,
): Promise<void> {
	await evaluateAlerts(appName, target.environmentId, frame, context.thresholds);
	await evaluateRules(
		target,
		appName,
		{ cpu: frame.cpu, memoryPercent: frame.memory.percent, restarts },
		context,
	);

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
}

/** Platform appNames are lowercase alnum + dash — refuse anything else for shell safety. */
const SAFE_APP_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** One SSH metrics batch per reachable remote server, servers sampled concurrently. */
async function sampleRemoteServers(
	remoteTargets: SampleTarget[],
	context: PassContext,
	now: number,
): Promise<void> {
	const byServer = new Map<string, SampleTarget[]>();
	for (const target of remoteTargets) {
		if (!target.serverId || !SAFE_APP_NAME.test(target.appName)) continue;
		const list = byServer.get(target.serverId) ?? [];
		list.push(target);
		byServer.set(target.serverId, list);
	}
	if (byServer.size === 0) return;

	const serverIds = [...byServer.keys()];
	const serverRows = await db.query.servers.findMany({
		where: inArray(servers.serverId, serverIds),
		columns: { serverId: true, name: true, metricsConfig: true, serverStatus: true },
	});
	const configByServerId = new Map(serverRows.map((row) => [row.serverId, row]));

	await Promise.all(
		[...byServer].map(([serverId, targets]) =>
			sampleOneRemoteServer(serverId, targets, configByServerId.get(serverId), context, now),
		),
	);
}

async function sampleOneRemoteServer(
	serverId: string,
	targets: SampleTarget[],
	server: { metricsConfig: unknown; serverStatus: string } | undefined,
	context: PassContext,
	now: number,
): Promise<void> {
	try {
		if (server?.serverStatus !== "active") return;
		const config = readServerMetricsConfig(server.metricsConfig);
		if (!config.enabled) return;
		const lastAt = remoteLastSampleAt.get(serverId) ?? 0;
		if (now - lastAt < config.intervalSeconds * 1000) return;

		const appNames = targets.map((target) => target.appName);
		const raw = await execAsyncRemote(
			serverId,
			buildRemoteSampleCommand(appNames, { restarts: context.wantRestarts }),
			{ timeoutMs: remoteSampleTimeoutMs(appNames.length) },
		);
		remoteLastSampleAt.set(serverId, now);

		const result = parseRemoteSampleOutput(raw, appNames);
		if (result.host) {
			await appendServerPoints(serverId, {
				t: now,
				cpu: result.host.cpuPercent,
				mu: result.host.memoryUsed,
				mt: result.host.memoryTotal,
				du: result.host.diskUsed,
				dt: result.host.diskTotal,
			});
		}
		for (const target of targets) {
			const restarts =
				context.wantRestarts && target.kind !== "other"
					? (result.restarts.get(target.appName) ?? 0)
					: null;
			const frame = result.services.get(target.appName);
			if (!frame) {
				// Not running on this node — restart-based rules still evaluate.
				await evaluateRules(target, target.appName, { restarts }, context);
				continue;
			}
			await handleFrame(
				target,
				target.appName,
				{
					cpu: frame.cpu,
					memory: {
						used: frame.memoryUsed,
						total: frame.memoryTotal,
						percent: frame.memoryTotal > 0 ? (frame.memoryUsed / frame.memoryTotal) * 100 : 0,
					},
					network: { rx: frame.rx, tx: frame.tx },
					block: { read: frame.blockRead, write: frame.blockWrite },
					pids: frame.pids,
				},
				context,
				now,
				restarts,
			);
		}
	} catch (error) {
		// Unreachable host, SSH hiccup, docker down — record and move on;
		// local sampling and the other servers are unaffected.
		log.warn("Remote metrics sample failed", {
			serverId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Last successful sample per server (in-memory; interval restarts on boot). */
const remoteLastSampleAt = new Map<string, number>();

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

/** Most recent metrics sample for a service, or null when no history exists. */
export async function readLatestMetricsSample(appName: string): Promise<HistorySample | null> {
	try {
		const text = await readFile(metricsFile(appName), "utf8");
		const lines = text.split("\n").filter(Boolean);
		const last = lines[lines.length - 1];
		if (!last) return null;
		return toSample(JSON.parse(last) as HistoryPoint);
	} catch {
		return null;
	}
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

const toServerSample = (point: ServerHistoryPoint): ServerHistorySample => ({
	t: point.t,
	cpuPercent: point.cpu,
	memoryUsed: point.mu,
	memoryTotal: point.mt,
	diskUsed: point.du,
	diskTotal: point.dt,
});

/**
 * Read the last `hours` of host-level history for a managed server,
 * downsampled like service history.
 */
export async function readServerMetricsHistory(
	serverId: string,
	hours: number,
): Promise<ServerHistorySample[]> {
	let points: ServerHistoryPoint[] = [];
	try {
		points = (await readFile(serverMetricsFile(serverId), "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ServerHistoryPoint);
	} catch {
		return [];
	}
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	const windowed = points.filter((point) => point.t >= cutoff);
	if (windowed.length <= MAX_POINTS_PER_READ) {
		return windowed.map(toServerSample);
	}
	const stride = windowed.length / MAX_POINTS_PER_READ;
	const sampled: ServerHistoryPoint[] = [];
	for (let index = 0; index < MAX_POINTS_PER_READ; index++) {
		const point = windowed[Math.floor(index * stride)];
		if (point) sampled.push(point);
	}
	return sampled.map(toServerSample);
}

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
			log.error("Metrics history pass failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			inFlight = false;
		}
	});
}
