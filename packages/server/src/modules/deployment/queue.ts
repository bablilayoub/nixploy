import type { TargetedProcess } from "./docker";

/**
 * In-memory FIFO deployment queue.
 *
 * - Jobs are grouped by target server (`serverId`, `null` = the Nixploy
 *   host) and each server runs up to `concurrency` deployments at once
 *   (default 1 — Docker builds are heavy, Dokploy serializes them too).
 * - **Per-app mutex**: two jobs for the same `appName` never run at the same
 *   time, whatever the concurrency — they would race on the code checkout and
 *   the `<appName>:latest` tag. A busy app's pending job is skipped in favour
 *   of the next app in line.
 * - **Coalescing**: enqueueing a job for an app that already has a *pending*
 *   job replaces the old one (returned as `superseded` so the caller can
 *   finalize its row). A push burst therefore yields at most one queued plus
 *   one running job per app.
 * - A job can be cancelled while pending (it is simply dequeued; the caller
 *   finalizes the deployment row) or while running (every child process the
 *   worker registered via {@link registerDeploymentProcess} is killed and
 *   the worker observes {@link isDeploymentCancelled}). Cancellations carry a
 *   {@link CancelReason} so the worker can tell a user cancel from a deadline
 *   or a panel shutdown.
 * - {@link drainQueue} stops dequeuing and waits (bounded) for running jobs —
 *   the graceful-shutdown hook. Queued rows are left `queued` in the database
 *   and re-enqueued by boot recovery (`recovery.ts`), so a restart no longer
 *   loses the backlog.
 * - The state itself lives on `globalThis` (see {@link QueueState}): this
 *   module is instantiated twice at runtime — once inside the Next route
 *   bundle (tRPC/REST/webhooks enqueue there) and once in the custom server
 *   (`server.ts` recovers and drains there) — and both must see one queue.
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
}

export type CancelLookup = "pending" | "running" | null;

/** Why a running job was told to stop. `user` is the default (cancel button / API). */
export type CancelReason = "user" | "shutdown" | "timeout";

/** Runs a dequeued job to completion. Registered by worker.ts at import time. */
type JobRunner = (job: QueueJob) => Promise<void>;

const serverKey = (serverId: string | null): string => serverId ?? "__local__";

interface RunningJob {
	key: string;
	job: QueueJob;
	/** Resolves once the runner settled and the slot was released. */
	settled: Promise<void>;
}

interface QueueState {
	/** Runs a dequeued job to completion; registered by worker.ts at import time. */
	runner: JobRunner | null;
	pendingByServer: Map<string, QueueJob[]>;
	runningCountByServer: Map<string, number>;
	runningJobs: Map<string, RunningJob>;
	/** appNames with a job in flight (per-app mutex). */
	runningApps: Set<string>;
	concurrencyByServer: Map<string, number>;
	processesByDeployment: Map<string, Set<TargetedProcess>>;
	cancelledDeployments: Map<string, CancelReason>;
	cancelHooks: Map<string, Set<() => void>>;
	/** True once {@link drainQueue} was called: nothing new gets started. */
	draining: boolean;
}

/**
 * Queue state is shared through `globalThis`, like `deploymentEvents`. Next
 * transpiles `@nixploy/server` into its route bundles, so the request graph
 * that enqueues jobs and the custom server (loaded through tsx) that
 * recovers and drains them are two instances of this module. Module-level
 * Maps gave each its own invisible queue: a SIGTERM drain reported nothing
 * running while a build was mid-flight and the row was abandoned `running`.
 */
const globalForQueue = globalThis as typeof globalThis & {
	__nixployDeploymentQueue?: QueueState;
};

const state: QueueState = globalForQueue.__nixployDeploymentQueue ?? {
	runner: null,
	pendingByServer: new Map(),
	runningCountByServer: new Map(),
	runningJobs: new Map(),
	runningApps: new Set(),
	concurrencyByServer: new Map(),
	processesByDeployment: new Map(),
	cancelledDeployments: new Map(),
	cancelHooks: new Map(),
	draining: false,
};

if (!globalForQueue.__nixployDeploymentQueue) {
	globalForQueue.__nixployDeploymentQueue = state;
}

const {
	pendingByServer,
	runningCountByServer,
	runningJobs,
	runningApps,
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
	void drain(serverKey(serverId));
}

/** Number of jobs waiting or running, per server — used by tests and monitoring. */
export function queueDepth(serverId: string | null): { pending: number; running: number } {
	const key = serverKey(serverId);
	return {
		pending: pendingByServer.get(key)?.length ?? 0,
		running: runningCountByServer.get(key) ?? 0,
	};
}

/**
 * 1-based position of a pending job in its server's line (1 = next to
 * start), or `null` when the deployment is not waiting in this process.
 */
export function getQueuePosition(deploymentId: string): number | null {
	for (const queue of pendingByServer.values()) {
		const index = queue.findIndex((job) => job.deploymentId === deploymentId);
		if (index !== -1) return index + 1;
	}
	return null;
}

/** True once {@link drainQueue} was called: nothing new gets started. */
export function isQueueDraining(): boolean {
	return state.draining;
}

/** Remove and return every pending job for an app (coalescing). */
function takePendingForApp(appName: string): QueueJob[] {
	const removed: QueueJob[] = [];
	for (const [key, queue] of pendingByServer) {
		for (let index = queue.length - 1; index >= 0; index--) {
			const job = queue[index];
			if (job?.appName === appName) {
				queue.splice(index, 1);
				removed.unshift(job);
			}
		}
		if (queue.length === 0) pendingByServer.delete(key);
	}
	return removed;
}

/**
 * Enqueue a job and kick the drain loop for its server. Any job for the same
 * app that was still waiting is dropped and returned as `superseded` — the
 * caller owns finalizing those deployment rows (see `queueDeployment`).
 */
export function enqueue(job: QueueJob): { superseded: QueueJob[] } {
	if (!state.runner) {
		throw new Error("Deployment worker is not registered (import modules/deployment first)");
	}
	const superseded = takePendingForApp(job.appName);
	const key = serverKey(job.serverId);
	const queue = pendingByServer.get(key) ?? [];
	queue.push(job);
	pendingByServer.set(key, queue);
	void drain(key);
	return { superseded };
}

/**
 * Start as many pending jobs as the server's concurrency allows, skipping
 * jobs whose app is already running (they stay in line, in order).
 */
function drain(key: string): void {
	if (!state.runner || state.draining) return;
	const queue = pendingByServer.get(key);
	if (!queue || queue.length === 0) return;

	let index = 0;
	while (index < queue.length) {
		const running = runningCountByServer.get(key) ?? 0;
		if (running >= getConcurrency(key)) break;
		const job = queue[index];
		if (!job) break;
		if (runningApps.has(job.appName)) {
			index += 1;
			continue;
		}
		queue.splice(index, 1);
		startJob(key, job);
	}
	if (queue.length === 0) pendingByServer.delete(key);
}

function startJob(key: string, job: QueueJob): void {
	runningCountByServer.set(key, (runningCountByServer.get(key) ?? 0) + 1);
	runningApps.add(job.appName);
	// Mark as running immediately so cancellation works even before the
	// worker spawns its first child process.
	processesByDeployment.set(job.deploymentId, new Set());

	let release!: () => void;
	const settled = new Promise<void>((resolve) => {
		release = resolve;
	});
	runningJobs.set(job.deploymentId, { key, job, settled });

	// Never let a rejected job take down the drain loop. The worker finalizes
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
			runningApps.delete(job.appName);
			runningJobs.delete(job.deploymentId);
			processesByDeployment.delete(job.deploymentId);
			cancelledDeployments.delete(job.deploymentId);
			cancelHooks.delete(job.deploymentId);
			release();
			void drain(key);
		});
}

/**
 * Remove a pending job or kill a running one.
 * Returns where the job was found (`null` = unknown deploymentId).
 * The first reason recorded for a running job wins.
 */
export function requestCancellation(
	deploymentId: string,
	reason: CancelReason = "user",
): CancelLookup {
	for (const [key, queue] of pendingByServer) {
		const index = queue.findIndex((job) => job.deploymentId === deploymentId);
		if (index !== -1) {
			queue.splice(index, 1);
			if (queue.length === 0) pendingByServer.delete(key);
			return "pending";
		}
	}
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
 * Graceful shutdown: stop starting jobs, drop the in-memory backlog (its rows
 * stay `queued` and are re-enqueued at next boot) and wait up to `graceMs`
 * for running jobs. Jobs still running afterwards are cancelled with reason
 * `shutdown` — the worker kills their processes and finalizes the rows as
 * `error` ("Interrupted by panel shutdown") — and get a short, bounded
 * window to do so. Idempotent: a second call just waits again.
 */
export async function drainQueue(options: { graceMs: number }): Promise<DrainResult> {
	state.draining = true;
	pendingByServer.clear();

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
