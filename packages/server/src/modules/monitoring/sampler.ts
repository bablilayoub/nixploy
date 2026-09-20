import type Docker from "dockerode";
import { inArray } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { servers } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { profileDefaults } from "../../lib/profile";
import { describeErrorWithCause } from "../../utils/error-cause";
import { execAsyncRemote } from "../../utils/exec";
import { fanOutConcurrency, mapWithConcurrency } from "../../utils/fan-out";
import { isServerUnreachable } from "../../utils/ssh-pool";
import { getDocker } from "../deployment/docker";
import { mapDockerStats } from "../docker/stats";
import {
	evaluateAlerts,
	evaluateRules,
	loadPassContext,
	type PassContext,
	type SampleTarget,
	type ServiceFrame,
} from "./alerts";
import {
	buildRemoteSampleCommand,
	countRecentFailedTasks,
	parseRemoteSampleOutput,
	readServerMetricsConfig,
	remoteSampleTimeoutMs,
} from "./remote";
import { appendServerPoint, appendServicePoint } from "./store";

const log = createLogger("metrics-history");

/**
 * Metrics sampling pass: every 30s a cron snapshots cpu/memory/network for
 * each running service into `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`
 * (the file layer lives in `./store.ts`, alerting in `./alerts.ts`).
 *
 * One pass costs a FIXED number of Docker API calls and DB queries, not a
 * multiple of the service count (audit #3):
 * - one `listContainers({ all: false })` indexed by Swarm/compose labels
 *   resolves every local service's container;
 * - one `listContainers({ all: true, status: exited })` answers every
 *   service's crash-loop restart count (only when a rule needs it);
 * - `stats({ stream: false })` stays per container — it is the only way to
 *   get a CPU delta (Docker's `one-shot` zeroes `precpu_stats`, which would
 *   report 0% CPU everywhere);
 * - the environment → organization lookup is one `inArray` query and the
 *   enabled alert rules are loaded once, both on the pass context.
 *
 * Remote services (hosted on a managed server) are sampled over one SSH batch
 * per server, servers in parallel — honoring that server's
 * `metricsConfig.metrics` (enabled / intervalSeconds) — alongside a
 * host-level snapshot stored as `server-<serverId>.jsonl`. A failing or
 * unreachable server is skipped without affecting local sampling.
 */

/** Sampler cron — every 30 s normally, every 2 min under `NIXPLOY_LITE`. */
const sampleCron = (): string => profileDefaults().metricsSampleCron;

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
	const localTargets = targets.filter((row) => !row.serverId);
	const remoteTargets = targets.filter((row) => row.serverId);
	const context = await loadPassContext(targets);
	const now = Date.now();

	// Local + every remote server run side by side: an unreachable remote
	// must not delay local sampling, and one slow `docker stats` must not
	// serialize the whole pass past the 30s cadence.
	await Promise.all([
		(async () => {
			if (localTargets.length === 0) return;
			const local = await loadLocalContainerIndex(
				localTargets.map((target) => target.appName),
				context.wantRestarts,
			);
			await mapWithConcurrency(localTargets, LOCAL_SAMPLE_CONCURRENCY, (target) =>
				sampleLocalTarget(target, local, context, now),
			);
		})(),
		sampleRemoteServers(remoteTargets, context, now),
	]);
}

/**
 * Which local container (if any) serves each app, plus the recent exited
 * containers per app — TWO `listContainers` calls for the whole pass instead
 * of three per service (plus three more per service for restarts).
 */
interface LocalContainerIndex {
	running: Map<string, string>;
	/** appName → exited containers (only loaded when a rule watches restarts). */
	exited: Map<string, { createdAt: number; status: string }[]>;
	docker: Docker;
}

/** Labels that tie a container to a Nixploy service, most specific first. */
const SERVICE_LABELS = [
	"com.docker.swarm.service.name",
	"com.docker.compose.project",
	"com.docker.stack.namespace",
] as const;

const appNameFromLabels = (
	labels: Record<string, string> | undefined,
	wanted: Set<string>,
): string | null => {
	for (const label of SERVICE_LABELS) {
		const value = labels?.[label];
		if (value && wanted.has(value)) return value;
	}
	return null;
};

async function loadLocalContainerIndex(
	appNames: string[],
	wantRestarts: boolean,
): Promise<LocalContainerIndex> {
	const docker = await getDocker();
	const wanted = new Set(appNames);
	const running = new Map<string, string>();
	const exited = new Map<string, { createdAt: number; status: string }[]>();

	const containers = await docker.listContainers({ all: false }).catch(() => []);
	for (const entry of containers) {
		const appName = appNameFromLabels(entry.Labels, wanted);
		// First match wins, like the old per-label probe order.
		if (appName && !running.has(appName)) running.set(appName, entry.Id);
	}

	if (wantRestarts) {
		const dead = await docker
			.listContainers({ all: true, filters: { status: ["exited"] } })
			.catch(() => []);
		for (const entry of dead) {
			const appName = appNameFromLabels(entry.Labels, wanted);
			if (!appName) continue;
			exited.set(appName, [
				...(exited.get(appName) ?? []),
				{ createdAt: entry.Created * 1000, status: entry.Status },
			]);
		}
	}

	return { running, exited, docker };
}

/** Max local `docker stats` calls in flight (each blocks ~1-2s). */
const LOCAL_SAMPLE_CONCURRENCY = 4;

/**
 * Restart signal for a local service: RestartCount of the running container
 * (in-place restarts, compose `restart:` policies) plus recently crashed task
 * containers (Swarm crash loops never restart in place). Both inputs come
 * from the per-pass container index — no per-service Docker calls.
 */
async function countLocalRestarts(
	appName: string,
	container: Docker.Container | null,
	local: LocalContainerIndex,
	now: number,
): Promise<number> {
	let restarts = 0;
	if (container) {
		const info = await container.inspect();
		restarts += info.RestartCount ?? 0;
	}
	restarts += countRecentFailedTasks(local.exited.get(appName) ?? [], now);
	return restarts;
}

async function sampleLocalTarget(
	target: SampleTarget,
	local: LocalContainerIndex,
	context: PassContext,
	now: number,
): Promise<void> {
	const appName = target.appName;
	try {
		const containerId = local.running.get(appName);
		const container = containerId ? local.docker.getContainer(containerId) : null;
		const restarts =
			context.wantRestarts && target.kind !== "other"
				? await countLocalRestarts(appName, container, local, now)
				: null;
		if (!container) {
			// Not running — no samples, no noise. Crash loops still feed the
			// restart-based rules so "restarts ≥ N" fires without a live container.
			await evaluateRules(target, appName, { restarts }, context);
			return;
		}
		// `stream: false` (two cycles, ~1 s) and NOT Docker's `one-shot`: the
		// latter zeroes `precpu_stats`, so every service would report 0% CPU.
		const stats = await container.stats({ stream: false });
		const frame = mapDockerStats(stats);
		await handleFrame(target, appName, frame, context, now, restarts);
	} catch (error) {
		// Usually a container racing a restart or a stats hiccup, and skipping
		// the pass is right. But `evaluateRules` and `handleFrame` also write
		// the alert-rule timestamp, insert the incident and read the
		// notification channels — so a database outage lands here too, and
		// swallowing it silently means the alert never fires and nothing
		// anywhere says why. Debug, because the common case is noise.
		log.debug("Local metrics sample failed", {
			appName,
			error: describeErrorWithCause(error),
		});
	}
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
	await evaluateAlerts(
		appName,
		context.owners.get(target.environmentId)?.organizationId ?? null,
		frame,
		context.thresholds,
	);
	await evaluateRules(
		target,
		appName,
		{ cpu: frame.cpu, memoryPercent: frame.memory.percent, restarts },
		context,
	);

	await appendServicePoint(appName, {
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

	// Bounded: a metrics pass must not open one SSH batch per server at once,
	// and a server whose SSH breaker is open is skipped outright.
	const pending = [...byServer].filter(([serverId]) => !isServerUnreachable(serverId));
	await mapWithConcurrency(pending, fanOutConcurrency(), ([serverId, targets]) =>
		sampleOneRemoteServer(serverId, targets, configByServerId.get(serverId), context, now),
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
			await appendServerPoint(serverId, {
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
			error: describeErrorWithCause(error),
		});
	}
}

/** Last successful sample per server (in-memory; interval restarts on boot). */
const remoteLastSampleAt = new Map<string, number>();

let started = false;
let inFlight = false;

/** Register the 30s metrics-history cron (boot, apps/web server.ts). */
export function initMetricsHistory(): void {
	if (started) return; // tsx watch / HMR re-invocations must not double-register
	started = true;
	schedule.scheduleJob("metrics-history", sampleCron(), async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await sampleAllServices();
		} catch (error) {
			log.error("Metrics history pass failed", {
				error: describeErrorWithCause(error),
			});
		} finally {
			inFlight = false;
		}
	});
}
