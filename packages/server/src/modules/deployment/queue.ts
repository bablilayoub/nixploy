import type { TargetedProcess } from "./docker";

/**
 * In-memory FIFO deployment queue.
 *
 * - Jobs are grouped by target server (`serverId`, `null` = the Nixploy
 *   host) and each server runs up to `concurrency` deployments at once
 *   (default 1 — Docker builds are heavy, Dokploy serializes them too).
 * - A job can be cancelled while pending (it is simply dequeued; the caller
 *   finalizes the deployment row) or while running (every child process the
 *   worker registered via {@link registerDeploymentProcess} is killed and
 *   the worker observes {@link isDeploymentCancelled}).
 */

export interface QueueJob {
	deploymentId: string;
	applicationId?: string;
	composeId?: string;
	previewDeploymentId?: string;
	type: "deploy" | "redeploy";
	serverId: string | null;
}

export type CancelLookup = "pending" | "running" | null;

/** Runs a dequeued job to completion. Registered by worker.ts at import time. */
type JobRunner = (job: QueueJob) => Promise<void>;

let runner: JobRunner | null = null;

/** Called once by the worker module to wire itself in (avoids a circular import). */
export function setJobRunner(jobRunner: JobRunner): void {
	runner = jobRunner;
}

const serverKey = (serverId: string | null): string => serverId ?? "__local__";

const pendingByServer = new Map<string, QueueJob[]>();
const runningCountByServer = new Map<string, number>();
const concurrencyByServer = new Map<string, number>();
const processesByDeployment = new Map<string, Set<TargetedProcess>>();
const cancelledDeployments = new Set<string>();

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

/** Enqueue a job and kick the drain loop for its server. */
export function enqueue(job: QueueJob): void {
	if (!runner) {
		throw new Error("Deployment worker is not registered (import modules/deployment first)");
	}
	const key = serverKey(job.serverId);
	const queue = pendingByServer.get(key) ?? [];
	queue.push(job);
	pendingByServer.set(key, queue);
	void drain(key);
}

function drain(key: string): void {
	const queue = pendingByServer.get(key);
	if (!queue || queue.length === 0 || !runner) return;

	const running = runningCountByServer.get(key) ?? 0;
	if (running >= getConcurrency(key)) return;

	const job = queue.shift();
	if (!job) return;
	runningCountByServer.set(key, running + 1);
	// Mark as running immediately so cancellation works even before the
	// worker spawns its first child process.
	processesByDeployment.set(job.deploymentId, new Set());

	// Never let a rejected job take down the drain loop.
	Promise.resolve()
		.then(() => runner?.(job))
		.catch(() => {})
		.finally(() => {
			runningCountByServer.set(key, Math.max(0, (runningCountByServer.get(key) ?? 1) - 1));
			processesByDeployment.delete(job.deploymentId);
			cancelledDeployments.delete(job.deploymentId);
			void drain(key);
		});
}

/**
 * Remove a pending job or kill a running one.
 * Returns where the job was found (`null` = unknown deploymentId).
 */
export function requestCancellation(deploymentId: string): CancelLookup {
	for (const [key, queue] of pendingByServer) {
		const index = queue.findIndex((job) => job.deploymentId === deploymentId);
		if (index !== -1) {
			queue.splice(index, 1);
			if (queue.length === 0) pendingByServer.delete(key);
			return "pending";
		}
	}
	if (processesByDeployment.has(deploymentId)) {
		cancelledDeployments.add(deploymentId);
		for (const proc of processesByDeployment.get(deploymentId) ?? []) {
			try {
				proc.kill();
			} catch {
				// process already exited
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

/** True once cancellation was requested for a running deployment. */
export function isDeploymentCancelled(deploymentId: string): boolean {
	return cancelledDeployments.has(deploymentId);
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
