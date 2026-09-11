import { and, eq, gte, inArray } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import {
	applications,
	compose,
	deployments,
	environments,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { forEachServerGroup } from "../../utils/fan-out";
import { isServerUnreachable } from "../../utils/ssh-pool";
import { shellQuote } from "../compose/paths";
import {
	type ServiceState,
	statusFromServiceState,
	summarizeTaskStates,
} from "../databases/engine";
import { notifyEvent } from "../notifications";
import { getDocker } from "./docker";
import { publishServiceStatusCorrections } from "./notify";

const log = createLogger("status-reconciler");

/** Don't flip freshly-deployed services to idle while Swarm tasks are still starting. */
const RECENT_DEPLOY_GRACE_MS = 3 * 60 * 1000;

/**
 * Status reconciler: periodically compares every service's stored status
 * with its real Docker/Swarm state and corrects drift. Drift happens when
 * containers change outside Nixploy (host reboot, `docker` CLI, daemon
 * resets) or when the app restarts mid-deploy — the row said one thing, the
 * runtime does another (the classic "container runs but UI says Error").
 */

type StoredStatus = "idle" | "running" | "done" | "error";
type LiveStatus = "idle" | "running" | "error";

export interface StatusCorrection {
	kind: string;
	id: string;
	appName: string;
	from: StoredStatus;
	to: StoredStatus;
	/** Present on service corrections; used by the failure watchdog. */
	environmentId?: string;
}

/**
 * Pure mapping of (stored status, live probe) → corrected status:
 * - live running: anything healthy becomes running (including legacy "done").
 * - live error (crash loop): anything becomes error.
 * - live idle (no service / scaled to zero): running/done become idle;
 *   error is kept — it records a failed deploy, not a running state.
 */
export function reconcileStatus(current: StoredStatus, live: LiveStatus): StoredStatus {
	if (live === "running") {
		return "running";
	}
	if (live === "error") {
		return "error";
	}
	return current === "running" || current === "done" ? "idle" : current;
}

/**
 * A status probe is a `docker ps` — it either answers in a second or the host
 * is not answering at all. Without this it inherited the 30 min remote command
 * budget, so a single dead server wedged the every-minute pass indefinitely
 * (`running` then swallowed every later tick).
 */
const PROBE_TIMEOUT_MS = 15_000;

const runOn = (serverId: string | null, command: string): Promise<string> =>
	serverId
		? execAsyncRemote(serverId, command, { timeoutMs: PROBE_TIMEOUT_MS })
		: execAsync(command, { timeout: PROBE_TIMEOUT_MS });

const NO_SERVICE: ServiceState = {
	exists: false,
	desired: 0,
	running: 0,
	pending: 0,
	failed: 0,
};

/**
 * Every swarm service's state in TWO Docker API calls — `listServices()` plus
 * `listTasks()`, grouped by `ServiceID` in memory — instead of the two calls
 * *per service* the pass used to make (audit #8: 100 services meant 200+
 * serialized round-trips a minute). Returns `null` when the daemon could not
 * be read at all: the caller then skips the swarm-backed rows rather than
 * mistaking "cannot see docker" for "nothing is deployed".
 */
interface SwarmSnapshot {
	/** Service name → live task summary. */
	byName: Map<string, ServiceState>;
	/** `com.docker.stack.namespace` label → the stack's service names. */
	byStack: Map<string, string[]>;
}

export async function loadSwarmSnapshot(): Promise<SwarmSnapshot | null> {
	try {
		const docker = await getDocker();
		const [services, tasks] = await Promise.all([docker.listServices(), docker.listTasks()]);
		const statesByServiceId = new Map<string, string[]>();
		for (const task of tasks) {
			const serviceId = task.ServiceID;
			if (!serviceId) continue;
			const states = statesByServiceId.get(serviceId) ?? [];
			states.push(task.Status?.State?.toLowerCase() ?? "");
			statesByServiceId.set(serviceId, states);
		}
		const byName = new Map<string, ServiceState>();
		const byStack = new Map<string, string[]>();
		for (const service of services) {
			const name = service.Spec?.Name;
			if (!name) continue;
			byName.set(name, {
				exists: true,
				desired: service.Spec?.Mode?.Replicated?.Replicas ?? 0,
				...summarizeTaskStates(statesByServiceId.get(service.ID ?? "") ?? []),
			});
			const stack = (service.Spec?.Labels as Record<string, string> | undefined)?.[
				"com.docker.stack.namespace"
			];
			if (stack) byStack.set(stack, [...(byStack.get(stack) ?? []), name]);
		}
		return { byName, byStack };
	} catch (error) {
		log.warn("Could not read swarm state — skipping swarm-backed reconciliation this pass", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/** A stack's live status, summed over the services carrying its namespace label. */
function stackState(snapshot: SwarmSnapshot, appName: string): LiveStatus {
	const names = snapshot.byStack.get(appName) ?? [];
	if (names.length === 0) return "idle";
	let running = 0;
	let failed = 0;
	for (const name of names) {
		const state = snapshot.byName.get(name);
		if (!state) continue;
		running += state.running;
		failed += state.failed;
	}
	if (running > 0) return "running";
	return failed > 0 ? "error" : "idle";
}

/**
 * Probe a plain (non-stack) compose deployment: its containers live on the
 * row's server and are probed there.
 */
async function probePlainComposeState(row: {
	appName: string;
	serverId: string | null;
}): Promise<LiveStatus> {
	// Prefer project/stack labels (never name= prefix).
	const out = await runOn(
		row.serverId,
		[
			`docker ps -a --filter ${shellQuote(`label=com.docker.compose.project=${row.appName}`)} --format '{{.State}} {{.Status}}'`,
			`docker ps -a --filter ${shellQuote(`label=com.docker.stack.namespace=${row.appName}`)} --format '{{.State}} {{.Status}}'`,
		].join("; "),
	);
	const lines = out
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "idle";
	let running = 0;
	let restarting = 0;
	let failedExit = 0;
	for (const line of lines) {
		const [state, ...statusParts] = line.split(/\s+/);
		const status = statusParts.join(" ");
		if (state === "running") running += 1;
		else if (state === "restarting") restarting += 1;
		else {
			const exitCode = status.match(/Exited \((\d+)\)/);
			if (exitCode && exitCode[1] !== "0") failedExit += 1;
		}
	}
	if (running > 0) return "running";
	if (restarting > 0 || failedExit > 0) return "error";
	return "idle"; // stopped via `docker compose stop`
}

interface SwarmBackedRow {
	id: string;
	appName: string;
	status: StoredStatus;
	serverId: string | null;
	environmentId: string;
}

interface SwarmBackedKind {
	kind: string;
	load: () => Promise<SwarmBackedRow[]>;
	update: (id: string, status: StoredStatus) => Promise<unknown>;
}

const selectCols = {
	appName: true,
	status: true,
	serverId: true,
	environmentId: true,
} as const;

const SWARM_BACKED: SwarmBackedKind[] = [
	{
		kind: "application",
		load: async () =>
			(
				await db.query.applications.findMany({
					columns: { applicationId: true, ...selectCols },
				})
			).map((row) => ({ ...row, id: row.applicationId })),
		update: (id, status) =>
			db.update(applications).set({ status }).where(eq(applications.applicationId, id)),
	},
	{
		kind: "postgres",
		load: async () =>
			(await db.query.postgres.findMany({ columns: { postgresId: true, ...selectCols } })).map(
				(row) => ({ ...row, id: row.postgresId }),
			),
		update: (id, status) => db.update(postgres).set({ status }).where(eq(postgres.postgresId, id)),
	},
	{
		kind: "mysql",
		load: async () =>
			(await db.query.mysql.findMany({ columns: { mysqlId: true, ...selectCols } })).map((row) => ({
				...row,
				id: row.mysqlId,
			})),
		update: (id, status) => db.update(mysql).set({ status }).where(eq(mysql.mysqlId, id)),
	},
	{
		kind: "mariadb",
		load: async () =>
			(await db.query.mariadb.findMany({ columns: { mariadbId: true, ...selectCols } })).map(
				(row) => ({ ...row, id: row.mariadbId }),
			),
		update: (id, status) => db.update(mariadb).set({ status }).where(eq(mariadb.mariadbId, id)),
	},
	{
		kind: "mongo",
		load: async () =>
			(await db.query.mongo.findMany({ columns: { mongoId: true, ...selectCols } })).map((row) => ({
				...row,
				id: row.mongoId,
			})),
		update: (id, status) => db.update(mongo).set({ status }).where(eq(mongo.mongoId, id)),
	},
	{
		kind: "redis",
		load: async () =>
			(await db.query.redis.findMany({ columns: { redisId: true, ...selectCols } })).map((row) => ({
				...row,
				id: row.redisId,
			})),
		update: (id, status) => db.update(redis).set({ status }).where(eq(redis.redisId, id)),
	},
];

/**
 * One reconcile pass over all services. Services with an in-flight
 * deployment are skipped (their status is being written by the worker).
 * Individual probe failures (e.g. unreachable remote docker) never abort
 * the pass.
 */
export async function reconcileServiceStatuses(): Promise<StatusCorrection[]> {
	const corrections: StatusCorrection[] = [];

	const busyDeployments = await db.query.deployments.findMany({
		where: eq(deployments.status, "running"),
		columns: { applicationId: true, composeId: true },
	});
	const busyApplications = new Set(busyDeployments.map((row) => row.applicationId).filter(Boolean));
	const busyCompose = new Set(busyDeployments.map((row) => row.composeId).filter(Boolean));

	const graceSince = new Date(Date.now() - RECENT_DEPLOY_GRACE_MS);
	const recentDone = await db.query.deployments.findMany({
		// Preview deploys share the parent's applicationId — without the
		// isPreview filter a finished preview would pin the production
		// service to "running" for the whole grace window.
		where: and(
			eq(deployments.status, "done"),
			eq(deployments.isPreview, false),
			gte(deployments.finishedAt, graceSince),
		),
		columns: { applicationId: true, composeId: true },
	});
	const graceApplications = new Set(recentDone.map((row) => row.applicationId).filter(Boolean));
	const graceCompose = new Set(recentDone.map((row) => row.composeId).filter(Boolean));

	// Two Docker API calls for the whole pass; every swarm-backed row (apps,
	// databases, compose stacks) is answered from this snapshot.
	const snapshot = await loadSwarmSnapshot();

	if (snapshot) {
		for (const descriptor of SWARM_BACKED) {
			const rows = await descriptor.load();
			for (const row of rows) {
				if (descriptor.kind === "application" && busyApplications.has(row.id)) continue;
				try {
					// Service state comes from the primary manager for every row,
					// pinned or not (see databases/engine.ts).
					const liveState = statusFromServiceState(snapshot.byName.get(row.appName) ?? NO_SERVICE);
					// statusFromServiceState never yields "done" today; keep the cast honest.
					const live: LiveStatus = liveState === "done" ? "running" : liveState;
					let next = reconcileStatus(row.status, live);
					if (
						next === "idle" &&
						(row.status === "running" || row.status === "done") &&
						descriptor.kind === "application" &&
						graceApplications.has(row.id)
					) {
						next = "running";
					}
					if (next !== row.status) {
						await descriptor.update(row.id, next);
						corrections.push({
							kind: descriptor.kind,
							id: row.id,
							appName: row.appName,
							from: row.status,
							to: next,
							environmentId: row.environmentId,
						});
					}
				} catch {
					// Row update failed (DB hiccup) — try again next pass.
				}
			}
		}
	}

	const composeRows = await db.query.compose.findMany({
		columns: {
			composeId: true,
			appName: true,
			composeType: true,
			status: true,
			serverId: true,
			environmentId: true,
		},
	});

	const applyCompose = async (row: (typeof composeRows)[number]): Promise<boolean> => {
		if (busyCompose.has(row.composeId)) return true;
		try {
			const live =
				row.composeType === "stack"
					? snapshot
						? stackState(snapshot, row.appName)
						: null
					: await probePlainComposeState(row);
			if (live === null) return true; // swarm unreadable: leave stacks alone
			let next = reconcileStatus(row.status, live);
			if (
				next === "idle" &&
				(row.status === "running" || row.status === "done") &&
				graceCompose.has(row.composeId)
			) {
				next = "running";
			}
			if (next !== row.status) {
				await db.update(compose).set({ status: next }).where(eq(compose.composeId, row.composeId));
				corrections.push({
					kind: "compose",
					id: row.composeId,
					appName: row.appName,
					from: row.status,
					to: next,
					environmentId: row.environmentId,
				});
			}
			return true;
		} catch {
			// Probe failed — try again next pass.
			return false;
		}
	};

	// Plain-compose probes shell out per row, so group them by server and run
	// a bounded number of servers side by side (audit #7): one unreachable host
	// no longer stretches the whole pass by its timeout × its row count, and a
	// server whose SSH breaker is open is skipped outright instead of paying
	// the connect timeout again for every row it owns.
	const skipped = new Set<string>();
	const fanOut = await forEachServerGroup(
		composeRows,
		(row) => row.serverId,
		async ({ serverId, items }) => {
			for (const row of items) {
				const ok = await applyCompose(row);
				// First failure on a managed server means the host, not the row:
				// stop paying the probe timeout for its remaining rows this pass.
				if (!ok && serverId) {
					skipped.add(serverId);
					break;
				}
			}
		},
		{ skipServer: isServerUnreachable },
	);
	const unreachable = [...new Set([...fanOut.skipped, ...skipped])];
	if (unreachable.length > 0) {
		log.warn("Skipped compose probes for unreachable servers", { servers: unreachable });
	}

	await notifyWatchdog(corrections);
	return corrections;
}

/**
 * Failure watchdog: services that just transitioned INTO error get an
 * `appBuildError` fan-out to their org's notification channels.
 */
async function notifyWatchdog(corrections: StatusCorrection[]): Promise<void> {
	const failures = corrections.filter(
		(correction) => correction.to === "error" && correction.environmentId,
	);
	if (failures.length === 0) return;
	const environmentRows = await db.query.environments.findMany({
		where: inArray(environments.environmentId, [
			...new Set(failures.map((failure) => failure.environmentId as string)),
		]),
		with: { project: true },
	});
	const orgByEnvironment = new Map(
		environmentRows.map((row) => [row.environmentId, row.project.organizationId]),
	);
	for (const failure of failures) {
		const organizationId = orgByEnvironment.get(failure.environmentId as string);
		if (!organizationId) continue;
		await notifyEvent(organizationId, "appBuildError", {
			title: "Service down",
			message: `${failure.kind} "${failure.appName}" is failing (status ${failure.from} → error). Check its logs and recent deployments.`,
			fields: [
				{ name: "Service", value: failure.appName },
				{ name: "Kind", value: failure.kind },
			],
		});
	}
}

let running = false;

/** Register the every-minute reconciler cron (boot, apps/web server.ts). */
export function initStatusReconciler(): void {
	schedule.scheduleJob("status-reconciler", "*/1 * * * *", async () => {
		if (running) return; // never overlap passes
		running = true;
		try {
			const corrections = await reconcileServiceStatuses();
			// Push the corrections to every open dashboard (`/ws/events`); the
			// panel turns them into query invalidations instead of polling.
			void publishServiceStatusCorrections(
				corrections.flatMap((fix) =>
					fix.environmentId ? [{ ...fix, environmentId: fix.environmentId }] : [],
				),
			);
			for (const fix of corrections) {
				log.info(`Status reconciler: ${fix.kind} ${fix.appName} ${fix.from} → ${fix.to}`);
			}
		} catch (error) {
			log.error("Status reconciler pass failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			running = false;
		}
	});
}
