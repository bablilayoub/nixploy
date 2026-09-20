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
import { shellQuote } from "../deployment/paths";
import {
	compareDockerTs,
	type DockerLogLine,
	demuxDockerLogs,
	dockerSinceParam,
	type RuntimeLogLine,
	splitDockerLogLines,
	toRuntimeLogLines,
} from "./format";
import {
	appendRuntimeLogLines,
	type HarvestState,
	hourKey,
	readHarvestState,
	sealClosedHours,
	writeHarvestState,
} from "./store";

/**
 * The 30 s harvest: `docker logs --timestamps --since <cursor>` for every
 * running container of every service, appended to the per-service hour
 * files. Worker role only (it is registered with the other crons), so it
 * never lands on the panel's memory.
 *
 * Per container the pass takes at most {@link MAX_LINES_PER_CONTAINER_PASS}
 * lines — a service printing faster than that loses the older ones and gets
 * an explicit `[nixploy] …` marker line instead of a silent gap. Cursors are
 * Docker's own timestamps (`state.json` per service), so a restart of the
 * worker resumes exactly where it stopped; a container never seen before
 * starts {@link FIRST_HARVEST_WINDOW_MS} back rather than at its birth.
 */

const log = createLogger("runtime-logs");

export const HARVEST_CRON = "*/30 * * * * *";
export const MAX_LINES_PER_CONTAINER_PASS = 2_000;
export const FIRST_HARVEST_WINDOW_MS = 10 * 60 * 1000;
/** Cursors of containers not seen for this long are forgotten. */
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const SAFE_APP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTAINER_ID_RE = /^[0-9a-f]{12}$/;
const DOCKER_TS_STRICT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const LOCAL_CONCURRENCY = 4;

/** `NIXPLOY_RUNTIME_LOGS=0` turns the harvester off (the read side keeps serving what exists). */
/**
 * Harvest what containers print? `NIXPLOY_RUNTIME_LOGS` decides when it is
 * set; otherwise the profile does — on normally, off under `NIXPLOY_LITE`
 * (`lib/profile.ts`), where the harvester's buffers and its disk are the
 * biggest thing a small box can give up.
 */
export const runtimeLogsEnabled = (): boolean => {
	const raw = process.env.NIXPLOY_RUNTIME_LOGS?.trim();
	if (raw) return raw !== "0";
	return profileDefaults().runtimeLogs;
};

interface HarvestTarget {
	appName: string;
	serverId: string | null;
}

/** Labels that tie a container to a Nixploy service, most specific first. */
const SERVICE_LABELS = [
	"com.docker.swarm.service.name",
	"com.docker.compose.project",
	"com.docker.stack.namespace",
] as const;

export async function listHarvestTargets(): Promise<HarvestTarget[]> {
	const columns = { appName: true, serverId: true } as const;
	const rows = await Promise.all([
		db.query.applications.findMany({ columns }),
		db.query.compose.findMany({ columns }),
		db.query.postgres.findMany({ columns }),
		db.query.mysql.findMany({ columns }),
		db.query.mariadb.findMany({ columns }),
		db.query.mongo.findMany({ columns }),
		db.query.redis.findMany({ columns }),
	]);
	return rows.flat().filter((row) => SAFE_APP_NAME.test(row.appName));
}

// ── shared per-app bookkeeping ──────────────────────────────────────────────

/**
 * Which app a container belongs to and how to name it inside the app: the
 * compose service for a stack, the swarm service minus the stack prefix for
 * a Swarm stack, nothing for a single-container service.
 */
export function resolveContainerOwner(
	labels: Record<string, string> | undefined,
	wanted: ReadonlySet<string>,
): { appName: string; container: string | null } | null {
	for (const label of SERVICE_LABELS) {
		const value = labels?.[label];
		if (!value || !wanted.has(value)) continue;
		const composeService = labels?.["com.docker.compose.service"];
		const swarmService = labels?.["com.docker.swarm.service.name"];
		let container: string | null = composeService ?? null;
		if (
			!container &&
			swarmService &&
			swarmService !== value &&
			swarmService.startsWith(`${value}_`)
		) {
			container = swarmService.slice(value.length + 1);
		}
		return { appName: value, container };
	}
	return null;
}

interface AppBatch {
	appName: string;
	state: HarvestState;
	lines: RuntimeLogLine[];
	touched: boolean;
}

const batches = new Map<string, AppBatch>();

async function batchFor(appName: string): Promise<AppBatch> {
	const existing = batches.get(appName);
	if (existing) return existing;
	const batch: AppBatch = {
		appName,
		state: await readHarvestState(appName),
		lines: [],
		touched: false,
	};
	batches.set(appName, batch);
	return batch;
}

/**
 * Keep the lines newer than the cursor, mark a capped pass, advance the
 * cursor. Shared by the local and the remote path so both behave alike.
 */
export function ingestContainerLines(
	batch: AppBatch,
	containerId: string,
	container: string | null,
	raw: DockerLogLine[],
	now: number,
): void {
	const cursor = batch.state.cursors[containerId]?.ts ?? null;
	const fresh = cursor ? raw.filter((line) => compareDockerTs(line.ts, cursor) > 0) : raw;
	const lines = toRuntimeLogLines(fresh, container);
	if (raw.length >= MAX_LINES_PER_CONTAINER_PASS && lines.length > 0) {
		const first = lines[0];
		lines.unshift({
			t: (first?.t ?? now) - 1,
			level: "warn",
			message: `[nixploy] more than ${MAX_LINES_PER_CONTAINER_PASS} lines since the last pass; older lines were dropped`,
			container,
		});
	}
	const last = fresh[fresh.length - 1];
	batch.state.cursors[containerId] = {
		ts: last?.ts ?? cursor ?? new Date(now).toISOString(),
		seenAt: now,
	};
	batch.touched = true;
	batch.lines.push(...lines);
}

function sinceFor(batch: AppBatch, containerId: string, now: number): string {
	return (
		batch.state.cursors[containerId]?.ts ?? new Date(now - FIRST_HARVEST_WINDOW_MS).toISOString()
	);
}

// ── local ───────────────────────────────────────────────────────────────────

async function harvestLocal(targets: HarvestTarget[], now: number): Promise<void> {
	if (targets.length === 0) return;
	const docker = await getDocker();
	const wanted = new Set(targets.map((target) => target.appName));
	const containers = await docker.listContainers({ all: false }).catch(() => []);
	const owned = containers
		.map((entry) => ({ entry, owner: resolveContainerOwner(entry.Labels, wanted) }))
		.filter(
			(item): item is { entry: Docker.ContainerInfo; owner: NonNullable<typeof item.owner> } =>
				Boolean(item.owner),
		);
	await mapWithConcurrency(owned, LOCAL_CONCURRENCY, async ({ entry, owner }) => {
		const containerId = entry.Id.slice(0, 12);
		const batch = await batchFor(owner.appName);
		try {
			const buffer = (await docker.getContainer(entry.Id).logs({
				follow: false,
				stdout: true,
				stderr: true,
				timestamps: true,
				since: dockerSinceParam(sinceFor(batch, containerId, now)) as unknown as number,
				tail: MAX_LINES_PER_CONTAINER_PASS,
			})) as unknown as Buffer;
			const raw = splitDockerLogLines(demuxDockerLogs(buffer));
			ingestContainerLines(batch, containerId, owner.container, raw, now);
		} catch (error) {
			log.debug("Local log harvest failed for a container", {
				appName: owner.appName,
				containerId,
				error: describeErrorWithCause(error),
			});
		}
	});
}

// ── remote (one SSH command per server) ─────────────────────────────────────

/**
 * One shell script per server: for every app, list its containers with the
 * compose service label, then `docker logs` each one since its own cursor.
 * Container ids and timestamps are validated before they are embedded; app
 * names are shell-quoted.
 */
export function buildRemoteHarvestCommand(
	apps: Array<{ appName: string; cursors: Record<string, string>; defaultSince: string }>,
): string {
	const lines: string[] = [];
	for (const app of apps) {
		if (!SAFE_APP_NAME.test(app.appName) || !DOCKER_TS_STRICT_RE.test(app.defaultSince)) continue;
		const quoted = shellQuote(app.appName);
		const format = shellQuote(
			'{{.ID}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.swarm.service.name"}}',
		);
		const cases = Object.entries(app.cursors)
			.filter(([id, ts]) => CONTAINER_ID_RE.test(id) && DOCKER_TS_STRICT_RE.test(ts))
			.map(([id, ts]) => `${id}) s=${shellQuote(ts)};;`)
			.join(" ");
		lines.push(
			`echo '==APP=='${quoted}`,
			`{ docker ps --filter label=com.docker.swarm.service.name=${quoted} --format ${format}; docker ps --filter label=com.docker.compose.project=${quoted} --format ${format}; docker ps --filter label=com.docker.stack.namespace=${quoted} --format ${format}; } 2>/dev/null | sort -u | while IFS= read -r line; do`,
			`  cid=$(printf '%s' "$line" | cut -d'|' -f1); s=${shellQuote(app.defaultSince)}`,
			`  case "$cid" in ${cases} esac`,
			`  echo "==CID==$line"`,
			`  docker logs --timestamps --since "$s" --tail ${MAX_LINES_PER_CONTAINER_PASS} "$cid" 2>&1`,
			"done",
		);
	}
	lines.push("true");
	return lines.join("\n");
}

/** Parse the script's output back into per-app, per-container line lists. */
export function parseRemoteHarvestOutput(raw: string): Array<{
	appName: string;
	containers: Array<{ id: string; name: string | null; lines: DockerLogLine[] }>;
}> {
	const result: Array<{
		appName: string;
		containers: Array<{ id: string; name: string | null; lines: DockerLogLine[] }>;
	}> = [];
	let app: (typeof result)[number] | null = null;
	let container: { id: string; name: string | null; lines: DockerLogLine[] } | null = null;
	let buffer: string[] = [];
	const flush = () => {
		if (container) container.lines = splitDockerLogLines(buffer.join("\n"));
		buffer = [];
	};
	for (const line of raw.split("\n")) {
		if (line.startsWith("==APP==")) {
			flush();
			container = null;
			const appName = line.slice(7).trim();
			app = SAFE_APP_NAME.test(appName) ? { appName, containers: [] } : null;
			if (app) result.push(app);
			continue;
		}
		if (line.startsWith("==CID==")) {
			flush();
			const [id = "", composeService = "", swarmService = ""] = line.slice(7).trim().split("|");
			if (!app || !CONTAINER_ID_RE.test(id)) {
				container = null;
				continue;
			}
			let name: string | null = composeService || null;
			if (!name && swarmService && swarmService.startsWith(`${app.appName}_`)) {
				name = swarmService.slice(app.appName.length + 1);
			}
			container = { id, name, lines: [] };
			app.containers.push(container);
			continue;
		}
		if (container) buffer.push(line);
	}
	flush();
	return result;
}

async function harvestRemote(targets: HarvestTarget[], now: number): Promise<void> {
	const byServer = new Map<string, HarvestTarget[]>();
	for (const target of targets) {
		if (!target.serverId) continue;
		byServer.set(target.serverId, [...(byServer.get(target.serverId) ?? []), target]);
	}
	if (byServer.size === 0) return;
	const rows = await db.query.servers.findMany({
		where: inArray(servers.serverId, [...byServer.keys()]),
		columns: { serverId: true, serverStatus: true },
	});
	const active = new Set(
		rows.filter((row) => row.serverStatus === "active").map((row) => row.serverId),
	);
	const pending = [...byServer].filter(
		([serverId]) => active.has(serverId) && !isServerUnreachable(serverId),
	);
	await mapWithConcurrency(pending, fanOutConcurrency(), async ([serverId, serverTargets]) => {
		const apps: Array<{ appName: string; cursors: Record<string, string>; defaultSince: string }> =
			[];
		for (const target of serverTargets) {
			const batch = await batchFor(target.appName);
			apps.push({
				appName: target.appName,
				cursors: Object.fromEntries(
					Object.entries(batch.state.cursors).map(([id, cursor]) => [id, cursor.ts]),
				),
				defaultSince: new Date(now - FIRST_HARVEST_WINDOW_MS).toISOString(),
			});
		}
		try {
			const raw = await execAsyncRemote(serverId, buildRemoteHarvestCommand(apps), {
				timeoutMs: 20_000 + serverTargets.length * 2_000,
			});
			for (const app of parseRemoteHarvestOutput(raw)) {
				const batch = await batchFor(app.appName);
				for (const container of app.containers) {
					ingestContainerLines(batch, container.id, container.name, container.lines, now);
				}
			}
		} catch (error) {
			log.debug("Remote log harvest failed", {
				serverId,
				error: describeErrorWithCause(error),
			});
		}
	});
}

// ── the pass ────────────────────────────────────────────────────────────────

let lastSealedHour: string | null = null;

/** One harvest pass over every service. Exported for tests and the CLI doctor. */
export async function harvestRuntimeLogs(
	now = Date.now(),
): Promise<{ apps: number; lines: number }> {
	batches.clear();
	const targets = await listHarvestTargets();
	await Promise.all([
		harvestLocal(
			targets.filter((target) => !target.serverId),
			now,
		),
		harvestRemote(
			targets.filter((target) => target.serverId),
			now,
		),
	]);

	let apps = 0;
	let lines = 0;
	const sealHour = hourKey(now) !== lastSealedHour;
	for (const batch of batches.values()) {
		if (!batch.touched) continue;
		for (const [id, cursor] of Object.entries(batch.state.cursors)) {
			if (now - cursor.seenAt > CURSOR_TTL_MS) delete batch.state.cursors[id];
		}
		batch.lines.sort((a, b) => a.t - b.t);
		try {
			await appendRuntimeLogLines(batch.appName, batch.lines);
			await writeHarvestState(batch.appName, batch.state);
			if (sealHour) await sealClosedHours(batch.appName, now);
		} catch (error) {
			log.warn("Could not write runtime logs", {
				appName: batch.appName,
				error: describeErrorWithCause(error),
			});
			continue;
		}
		apps += 1;
		lines += batch.lines.length;
	}
	if (sealHour) lastSealedHour = hourKey(now);
	batches.clear();
	return { apps, lines };
}

let started = false;
let inFlight = false;

/** Register the 30 s harvest cron (idempotent; worker role only, like every cron). */
export function initRuntimeLogHarvest(): void {
	if (started) return; // tsx watch / HMR re-invocations must not double-register
	started = true;
	if (!runtimeLogsEnabled()) {
		log.info("Runtime log harvest disabled (NIXPLOY_RUNTIME_LOGS=0)");
		return;
	}
	schedule.scheduleJob("runtime-log-harvest", HARVEST_CRON, async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await harvestRuntimeLogs();
		} catch (error) {
			log.error("Runtime log harvest failed", {
				error: describeErrorWithCause(error),
			});
		} finally {
			inFlight = false;
		}
	});
}
