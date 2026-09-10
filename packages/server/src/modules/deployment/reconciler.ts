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
import { shellQuote } from "../compose/paths";
import { inspectServiceState, statusFromServiceState } from "../databases/engine";
import { notifyEvent } from "../notifications";

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

const runOn = (serverId: string | null, command: string): Promise<string> =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

/**
 * Probe a compose deployment. Stack services are Swarm objects and are read
 * from the primary manager whatever server the row is pinned to; plain
 * compose containers live on the row's server and are probed there.
 */
async function probeComposeState(row: {
	appName: string;
	composeType: string;
	serverId: string | null;
}): Promise<LiveStatus> {
	if (row.composeType === "stack") {
		const out = await execAsync(
			`docker service ls --filter ${shellQuote(`label=com.docker.stack.namespace=${row.appName}`)} --format '{{.Name}}'`,
		);
		const names = out
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (names.length === 0) return "idle";
		let running = 0;
		let failed = 0;
		for (const name of names) {
			const state = await inspectServiceState(name);
			running += state.running;
			failed += state.failed;
		}
		if (running > 0) return "running";
		return failed > 0 ? "error" : "idle";
	}

	// Plain docker compose: prefer project/stack labels (never name= prefix).
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

	for (const descriptor of SWARM_BACKED) {
		const rows = await descriptor.load();
		for (const row of rows) {
			if (descriptor.kind === "application" && busyApplications.has(row.id)) continue;
			try {
				// Service state comes from the primary manager for every row,
				// pinned or not (see databases/engine.ts).
				const liveState = statusFromServiceState(await inspectServiceState(row.appName));
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
				// Probe failed (remote daemon down, docker hiccup) — try again next pass.
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
	for (const row of composeRows) {
		if (busyCompose.has(row.composeId)) continue;
		try {
			const live = await probeComposeState(row);
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
		} catch {
			// Probe failed — try again next pass.
		}
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
