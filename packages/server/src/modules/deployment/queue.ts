import { sql } from "drizzle-orm";
import { db } from "../../db";
import { isWorkerRole } from "../../lib/role";
import type { TargetedProcess } from "./docker";
import { deploymentEvents } from "./events";
import { publishDeploymentStatusDetached } from "./notify";

/**
 * Durable deployment queue.
 *
 * The `deployment` table is the source of truth: `queueDeployment`
 * (`./index.ts`) inserts a row with `status = 'queued'` and this module's
 * worker loop claims it with a single atomic statement
 * (`UPDATE … WHERE deployment_id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`,
 * see {@link claimNextDeployment}). Nothing about *which* job runs next lives
 * in process memory any more, so a restart, a crash or a SIGKILL mid-build
 * never loses the backlog — the rows are still `queued` and the next boot
 * picks them up.
 *
 * What the claim query enforces, in SQL:
 * - **FIFO per target server** (`server_id IS NOT DISTINCT FROM $1`,
 *   `ORDER BY created_at, deployment_id`).
 * - **Per-app mutex** — `NOT EXISTS (… status = 'running' … same app_name)`:
 *   two jobs for one service never build at the same time whatever
 *   `NIXPLOY_DEPLOY_CONCURRENCY` says (they would race on the code checkout
 *   and the `<appName>:latest` tag). A busy app's row stays in line and the
 *   next app's row takes the free slot.
 * - **SKIP LOCKED** — two claimers can never be handed the same row.
 *
 * Since migration 0023 the row carries `app_name` (the service the job really
 * builds — `<app>-pr-<n>` for a preview) and `preview_deployment_id`, so all
 * three rules are plain predicates on `deployment` with no joins and no
 * in-process registry. Previews are ordinary rows now: they coalesce against
 * their own siblings, take part in the same mutex, and survive a restart.
 *
 * What is still process-local, and why:
 * - the slot accounting per server (`NIXPLOY_DEPLOY_CONCURRENCY`), the set of
 *   running jobs, their child processes and their cancellation state — all of
 *   it only has meaning inside the process that is actually building;
 * - the queue-position / depth snapshot, which is *computed in SQL* on every
 *   pass and cached so `getQueuePosition` / `queueDepth` can stay synchronous
 *   for their tRPC and `/api/ready` callers.
 *
 * The state lives on `globalThis` (see {@link QueueState}): this module is
 * instantiated twice at runtime — once inside the Next route bundle
 * (tRPC/REST/webhooks enqueue there) and once in the custom server
 * (`server.ts`, loaded through tsx, recovers and drains there). Both must see
 * one set of running jobs, and only one of them may run the claim loop.
 */

export interface QueueJob {
	deploymentId: string;
	/** Service name the job builds/deploys — the per-app mutex + coalescing key. */
	appName: string;
	applicationId?: string;
	composeId?: string;
	previewDeploymentId?: string;
	type: "deploy" | "redeploy";
	serverId: string | null;
	/** Branch/tag/sha the caller asked for; null = the configured branch. */
	requestedRef?: string;
}

export type CancelLookup = "pending" | "running" | null;

/** Why a running job was told to stop. `user` is the default (cancel button / API). */
export type CancelReason = "user" | "shutdown" | "timeout";

/** Runs a claimed job to completion. Registered by worker.ts at import time. */
type JobRunner = (job: QueueJob) => Promise<void>;

const serverKey = (serverId: string | null): string => serverId ?? "__local__";
const serverIdFromKey = (key: string): string | null => (key === "__local__" ? null : key);

interface RunningJob {
	key: string;
	job: QueueJob;
	/** Resolves once the runner settled and the slot was released. */
	settled: Promise<void>;
}

interface QueueState {
	/** Runs a claimed job to completion; registered by worker.ts at import time. */
	runner: JobRunner | null;
	runningCountByServer: Map<string, number>;
	runningJobs: Map<string, RunningJob>;
	concurrencyByServer: Map<string, number>;
	processesByDeployment: Map<string, Set<TargetedProcess>>;
	cancelledDeployments: Map<string, CancelReason>;
	cancelHooks: Map<string, Set<() => void>>;
	/** True once {@link drainQueue} was called: nothing new gets claimed. */
	draining: boolean;
	/** SQL snapshot: 1-based position of every queued row in its server's line. */
	positions: Map<string, number>;
	/** SQL snapshot: queued row count per server key. */
	pendingByServer: Map<string, number>;
	/** Claim-loop bookkeeping — only one loop may run per process. */
	loopStarted: boolean;
	loopBusy: boolean;
	timer: NodeJS.Timeout | null;
}

/**
 * Queue state is shared through `globalThis`, like `deploymentEvents`. Next
 * transpiles `@nixploy/server` into its route bundles, so the request graph
 * that enqueues jobs and the custom server (loaded through tsx) that recovers
 * and drains them are two instances of this module. Module-level Maps gave
 * each its own invisible queue: a SIGTERM drain reported nothing running
 * while a build was mid-flight and the row was abandoned `running`.
 */
const globalForQueue = globalThis as typeof globalThis & {
	__nixployDeploymentQueue?: QueueState;
};

const state: QueueState = globalForQueue.__nixployDeploymentQueue ?? {
	runner: null,
	runningCountByServer: new Map(),
	runningJobs: new Map(),
	concurrencyByServer: new Map(),
	processesByDeployment: new Map(),
	cancelledDeployments: new Map(),
	cancelHooks: new Map(),
	draining: false,
	positions: new Map(),
	pendingByServer: new Map(),
	loopStarted: false,
	loopBusy: false,
	timer: null,
};

if (!globalForQueue.__nixployDeploymentQueue) {
	globalForQueue.__nixployDeploymentQueue = state;
}

const {
	runningCountByServer,
	runningJobs,
	concurrencyByServer,
	processesByDeployment,
	cancelledDeployments,
	cancelHooks,
} = state;

/**
 * Called by the worker module at import time to wire itself in (avoids a
 * circular import). Each module instance registers its own runner; the last
 * one wins, and they are equivalent.
 */
export function setJobRunner(jobRunner: JobRunner): void {
	state.runner = jobRunner;
}

const getConcurrency = (key: string): number =>
	concurrencyByServer.get(key) ??
	Math.max(1, Number.parseInt(process.env.NIXPLOY_DEPLOY_CONCURRENCY ?? "1", 10) || 1);

/** Override the concurrency of one server (defaults to 1 / env var). */
export function setServerConcurrency(serverId: string | null, concurrency: number): void {
	concurrencyByServer.set(serverKey(serverId), Math.max(1, concurrency));
	pokeQueue();
}

/**
 * Jobs waiting or running, per server. `pending` comes from the SQL snapshot
 * refreshed by every claim pass (and synchronously after an enqueue), so it
 * counts rows this process has not claimed yet — including a backlog left by
 * a previous run.
 */
export function queueDepth(serverId: string | null): { pending: number; running: number } {
	const key = serverKey(serverId);
	return {
		pending: state.pendingByServer.get(key) ?? 0,
		running: runningCountByServer.get(key) ?? 0,
	};
}

/**
 * 1-based position of a queued row in its server's line (1 = next to start),
 * or `null` when the deployment is not waiting. Read from the SQL snapshot —
 * `deployment.byApplication` / `byProject` / … render it as "Queued (#n)".
 */
export function getQueuePosition(deploymentId: string): number | null {
	return state.positions.get(deploymentId) ?? null;
}

/** True once {@link drainQueue} was called: nothing new gets claimed. */
export function isQueueDraining(): boolean {
	return state.draining;
}

/* -------------------------------------------------------------------------- */
/*  SQL: claim, snapshot                                                      */
/* -------------------------------------------------------------------------- */

interface ClaimedRow {
	deployment_id: string;
	application_id: string | null;
	compose_id: string | null;
	title: string | null;
	server_id: string | null;
	app_name: string | null;
	preview_deployment_id: string | null;
	requested_ref: string | null;
}

/**
 * Claim the oldest runnable `queued` row for one server and flip it to
 * `running` in the same statement. Returns `null` when nothing is runnable
 * (empty line, every candidate's app already building, every row locked by
 * another claimer).
 *
 * `app_name is not null` is the orphan guard: every row the queue writes
 * carries one, so a NULL means a row the queue can no longer place (a legacy
 * preview from before migration 0023). Boot recovery finalizes those.
 */
export async function claimNextDeployment(serverId: string | null): Promise<QueueJob | null> {
	const rows = (await db.execute(sql`
		update "deployment" d
		set "status" = 'running', "started_at" = now()
		from (
			select q."deployment_id"
			from "deployment" q
			where q."status" = 'queued'
				and q."server_id" is not distinct from ${serverId}::text
				and q."app_name" is not null
				and not exists (
					select 1
					from "deployment" r
					where r."status" = 'running' and r."app_name" = q."app_name"
				)
			order by q."created_at", q."deployment_id"
			for update skip locked
			limit 1
		) s
		where d."deployment_id" = s."deployment_id"
		returning d."deployment_id", d."application_id", d."compose_id",
			d."title", d."server_id", d."app_name", d."preview_deployment_id",
			d."requested_ref"
	`)) as unknown as ClaimedRow[];

	const row = rows[0];
	if (!row?.app_name) return null;

	return {
		deploymentId: row.deployment_id,
		appName: row.app_name,
		applicationId: row.application_id ?? undefined,
		composeId: row.compose_id ?? undefined,
		previewDeploymentId: row.preview_deployment_id ?? undefined,
		// Cosmetic only (the worker prints it): the row records the title, not
		// the verb, and every redeploy title ends in "redeploy".
		type: row.title?.toLowerCase().endsWith("redeploy") ? "redeploy" : "deploy",
		serverId: row.server_id,
		requestedRef: row.requested_ref ?? undefined,
	};
}

interface QueuedRow {
	deployment_id: string;
	server_id: string | null;
	pos: string | number;
}

/**
 * Recompute the queue-position / depth snapshot from SQL. One window query
 * over the (indexed) in-flight rows; callers read it synchronously afterwards.
 */
export async function refreshQueueSnapshot(): Promise<number> {
	const rows = (await db.execute(sql`
		select "deployment_id", "server_id",
			row_number() over (
				partition by "server_id" order by "created_at", "deployment_id"
			) as pos
		from "deployment"
		where "status" = 'queued'
	`)) as unknown as QueuedRow[];

	const positions = new Map<string, number>();
	const pending = new Map<string, number>();
	for (const row of rows) {
		positions.set(row.deployment_id, Number(row.pos));
		const key = serverKey(row.server_id);
		pending.set(key, (pending.get(key) ?? 0) + 1);
	}
	state.positions = positions;
	state.pendingByServer = pending;
	return rows.length;
}

/* -------------------------------------------------------------------------- */
/*  Claim loop                                                                */
/* -------------------------------------------------------------------------- */

/** Poll cadence while rows are waiting (the `enqueued` event wakes it sooner). */
const BUSY_POLL_MS = 2_000;
/** Poll cadence while the line is empty — a pure safety net. */
const IDLE_POLL_MS = 15_000;

function scheduleNextPass(delayMs: number): void {
	if (state.draining || !state.loopStarted) return;
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => {
		state.timer = null;
		void runClaimPass();
	}, delayMs);
	// Never hold the event loop open on the queue's account.
	state.timer.unref?.();
}

/**
 * One claim pass: refresh the snapshot, then fill every server's free slots
 * from the database, oldest row first.
 */
async function runClaimPass(): Promise<void> {
	if (state.loopBusy || state.draining || !state.runner) return;
	state.loopBusy = true;
	let waiting = 0;
	try {
		waiting = await refreshQueueSnapshot();
		for (const key of [...state.pendingByServer.keys()]) {
			while (!state.draining) {
				const running = runningCountByServer.get(key) ?? 0;
				if (running >= getConcurrency(key)) break;
				const job = await claimNextDeployment(serverIdFromKey(key));
				if (!job) break;
				startJob(key, job);
				// queued → running: the only place that transition is made, so
				// the only place it has to be published (`/ws/events`).
				publishDeploymentStatusDetached(job.deploymentId, "running");
			}
		}
		if (waiting > 0) waiting = await refreshQueueSnapshot();
	} catch (error) {
		// A DB hiccup must not kill the loop — try again on the next tick.
		console.error(
			"Deploy queue claim pass failed:",
			error instanceof Error ? error.message : error,
		);
	} finally {
		state.loopBusy = false;
		scheduleNextPass(waiting > 0 ? BUSY_POLL_MS : IDLE_POLL_MS);
	}
}

/**
 * Start the claim loop (idempotent, once per process). Called from boot
 * recovery and lazily by `queueDeployment`, so neither `next build` nor the
 * offline unit tests ever open a database connection on import.
 *
 * Refused in role `panel` (`NIXPLOY_ROLE=panel`, `lib/role.ts`): that process
 * enqueues rows and wakes the worker over `NOTIFY`, but must never claim one —
 * it has no build tooling mounted and would race the worker for the slot.
 */
export function startQueueLoop(): void {
	if (!isWorkerRole()) return;
	if (state.loopStarted || state.draining) return;
	state.loopStarted = true;
	deploymentEvents.on("enqueued", onEnqueued);
	void runClaimPass();
}

const onEnqueued = (): void => {
	pokeQueue();
};

/** Wake the loop now instead of waiting for the next tick. */
export function pokeQueue(): void {
	if (!state.loopStarted || state.draining) return;
	if (state.loopBusy) return;
	scheduleNextPass(0);
}

/** Stop the loop and detach its listener (tests, shutdown). */
export function stopQueueLoop(): void {
	if (state.timer) clearTimeout(state.timer);
	state.timer = null;
	if (state.loopStarted) deploymentEvents.off("enqueued", onEnqueued);
	state.loopStarted = false;
}

/* -------------------------------------------------------------------------- */
/*  Running jobs                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hand a claimed job to the worker and hold its slot until it settles. The
 * row is already `running` in the database (the claim did that atomically);
 * this only tracks the process-side state — slot accounting, per-app mutex,
 * child processes and cancellation.
 *
 * Exported because the worker's unit tests drive it directly (they mock the
 * database away and never reach the claim query).
 */
export function startJob(key: string, job: QueueJob): void {
	runningCountByServer.set(key, (runningCountByServer.get(key) ?? 0) + 1);
	// Mark as running immediately so cancellation works even before the
	// worker spawns its first child process.
	processesByDeployment.set(job.deploymentId, new Set());

	let release!: () => void;
	const settled = new Promise<void>((resolve) => {
		release = resolve;
	});
	runningJobs.set(job.deploymentId, { key, job, settled });

	// Never let a rejected job take down the claim loop. The worker finalizes
	// its own deployment row; a rejection here means it failed before it
	// could (DB down, unwritable log dir) — say so instead of hiding it.
	Promise.resolve()
		.then(() => state.runner?.(job))
		.catch((error: unknown) => {
			console.error(
				`Deployment ${job.deploymentId} crashed outside the worker's error handling:`,
				error instanceof Error ? error.message : error,
			);
		})
		.finally(() => {
			runningCountByServer.set(key, Math.max(0, (runningCountByServer.get(key) ?? 1) - 1));
			runningJobs.delete(job.deploymentId);
			processesByDeployment.delete(job.deploymentId);
			cancelledDeployments.delete(job.deploymentId);
			cancelHooks.delete(job.deploymentId);
			release();
			// A freed slot may unblock the next row (and the per-app mutex).
			pokeQueue();
		});
}

/**
 * Kill a running job. A row that is still `queued` is NOT touched here — the
 * caller (`cancelDeployment`) finalizes it in SQL, which is what makes the
 * cancellation atomic against a concurrent claim.
 * Returns where the job was found (`null` = not running in this process).
 * The first reason recorded for a running job wins.
 */
export function requestCancellation(
	deploymentId: string,
	reason: CancelReason = "user",
): CancelLookup {
	if (processesByDeployment.has(deploymentId)) {
		if (!cancelledDeployments.has(deploymentId)) {
			cancelledDeployments.set(deploymentId, reason);
		}
		for (const proc of processesByDeployment.get(deploymentId) ?? []) {
			try {
				proc.kill();
			} catch {
				// process already exited
			}
		}
		for (const hook of cancelHooks.get(deploymentId) ?? []) {
			try {
				hook();
			} catch {
				// a hook must never break the cancellation of other listeners
			}
		}
		return "running";
	}
	return null;
}

/**
 * Register a child process spawned for a running deployment so
 * {@link requestCancellation} can kill it. If the deployment was cancelled
 * just before registration the process is killed immediately.
 */
export function registerDeploymentProcess(deploymentId: string, proc: TargetedProcess): void {
	if (cancelledDeployments.has(deploymentId)) {
		proc.kill();
		return;
	}
	let set = processesByDeployment.get(deploymentId);
	if (!set) {
		set = new Set();
		processesByDeployment.set(deploymentId, set);
	}
	set.add(proc);
	// `.finally()` returns a NEW promise that rejects when `proc.done`
	// rejects — an unhandled rejection that kills the whole Node process.
	// `.then(onSettle, onSettle)` settles in both directions instead.
	void proc.done.then(
		() => set.delete(proc),
		() => set.delete(proc),
	);
}

/**
 * Run `hook` as soon as the running deployment is cancelled (immediately when
 * it already was). Lets the worker abandon a step that is not process-bound
 * (a hung SSH handshake, Docker API call or DB query) instead of waiting on
 * it forever. Returns an unsubscribe function.
 */
export function onDeploymentCancelled(deploymentId: string, hook: () => void): () => void {
	if (cancelledDeployments.has(deploymentId)) {
		hook();
		return () => {};
	}
	let hooks = cancelHooks.get(deploymentId);
	if (!hooks) {
		hooks = new Set();
		cancelHooks.set(deploymentId, hooks);
	}
	hooks.add(hook);
	return () => {
		hooks.delete(hook);
	};
}

/** True once cancellation was requested for a running deployment. */
export function isDeploymentCancelled(deploymentId: string): boolean {
	return cancelledDeployments.has(deploymentId);
}

/** Why the running deployment was cancelled, or `null` when it was not. */
export function getCancellationReason(deploymentId: string): CancelReason | null {
	return cancelledDeployments.get(deploymentId) ?? null;
}

/** Throw when the deployment was cancelled — checked between pipeline steps. */
export function throwIfCancelled(deploymentId: string): void {
	if (cancelledDeployments.has(deploymentId)) {
		throw new DeploymentCancelledError(deploymentId);
	}
}

/** Marker error so the worker can distinguish cancellation from failure. */
export class DeploymentCancelledError extends Error {
	constructor(readonly deploymentId: string) {
		super(`Deployment ${deploymentId} was cancelled`);
		this.name = "DeploymentCancelledError";
	}
}

export interface DrainResult {
	/** Jobs that finished on their own inside the grace period. */
	completed: number;
	/** Jobs that were still running when the grace expired and got cancelled. */
	interrupted: number;
}

/** Extra time given to the worker to finalize rows after a shutdown cancel. */
const FINALIZE_GRACE_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * Graceful shutdown: stop claiming rows and wait up to `graceMs` for the jobs
 * already running. Jobs still running afterwards are cancelled with reason
 * `shutdown` — the worker kills their processes and finalizes the rows as
 * `error` ("Interrupted by panel shutdown") — and get a short, bounded window
 * to do so. The backlog needs no handling at all any more: those rows are
 * still `queued` in Postgres and the next boot claims them. Idempotent: a
 * second call just waits again.
 */
export async function drainQueue(options: { graceMs: number }): Promise<DrainResult> {
	state.draining = true;
	stopQueueLoop();

	const running = [...runningJobs.values()];
	if (running.length === 0) return { completed: 0, interrupted: 0 };

	const everything = Promise.all(running.map((entry) => entry.settled)).then(() => true);
	const finishedInTime = await Promise.race([everything, sleep(options.graceMs).then(() => false)]);
	if (finishedInTime) return { completed: running.length, interrupted: 0 };

	const stragglers = running.filter((entry) => runningJobs.has(entry.job.deploymentId));
	for (const entry of stragglers) {
		requestCancellation(entry.job.deploymentId, "shutdown");
	}
	await Promise.race([everything, sleep(FINALIZE_GRACE_MS)]);
	return { completed: running.length - stragglers.length, interrupted: stragglers.length };
}
