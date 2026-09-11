import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueJob } from "./queue";

// The queue keeps its state on globalThis (shared with the Next bundle), so a
// fresh module is not enough: drop the shared state before every test too.
type QueueModule = typeof import("./queue");
let queue: QueueModule;

const resetQueueState = () => {
	delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
};

beforeEach(async () => {
	vi.resetModules();
	resetQueueState();
	queue = await import("./queue");
});

/** Flush the microtask/promise chain the drain loop runs on. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** By default every job is its own app; pass `appName` to share one. */
const job = (deploymentId: string, serverId: string | null = null, appName = deploymentId) => ({
	deploymentId,
	appName,
	type: "deploy" as const,
	serverId,
});

interface Deferred {
	resolve: () => void;
	reject: (error: Error) => void;
}

/** A mock runner whose completions the test controls explicitly. */
function controlledRunner() {
	const started: string[] = [];
	const gates = new Map<string, Deferred>();
	const runner = vi.fn((j: QueueJob) => {
		started.push(j.deploymentId);
		return new Promise<void>((resolve, reject) => {
			gates.set(j.deploymentId, {
				resolve: () => resolve(),
				reject: (error: Error) => reject(error),
			});
		});
	});
	const finish = async (deploymentId: string) => {
		gates.get(deploymentId)?.resolve();
		await flush();
	};
	return { runner, started, finish };
}

describe("deployment queue", () => {
	it("throws when no job runner is registered", () => {
		expect(() => queue.enqueue(job("j1"))).toThrow(/worker is not registered/);
	});

	it("runs jobs on one server serially in FIFO order", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("j1"));
		queue.enqueue(job("j2"));
		queue.enqueue(job("j3"));
		await flush();

		// Default concurrency is 1: only the first job runs.
		expect(started).toEqual(["j1"]);
		expect(queue.queueDepth(null)).toEqual({ pending: 2, running: 1 });

		await finish("j1");
		expect(started).toEqual(["j1", "j2"]);

		await finish("j2");
		expect(started).toEqual(["j1", "j2", "j3"]);

		await finish("j3");
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});

	it("runs different servers in parallel while each server stays serial", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("a1", "server-a"));
		queue.enqueue(job("a2", "server-a"));
		queue.enqueue(job("b1", "server-b"));
		await flush();

		// Both servers run their first job at once; a2 waits for a1.
		expect(started.sort()).toEqual(["a1", "b1"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 1 });
		expect(queue.queueDepth("server-b")).toEqual({ pending: 0, running: 1 });

		await finish("a1");
		expect(started).toContain("a2");
		expect(queue.queueDepth("server-a")).toEqual({ pending: 0, running: 1 });
	});

	it("honors setServerConcurrency", async () => {
		const { runner, started } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 2);

		queue.enqueue(job("a1", "server-a"));
		queue.enqueue(job("a2", "server-a"));
		queue.enqueue(job("a3", "server-a"));
		await flush();

		expect(started.sort()).toEqual(["a1", "a2"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 2 });
	});

	it("starts every job the concurrency allows in one drain pass", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 3);

		for (const id of ["a1", "a2", "a3", "a4", "a5"]) queue.enqueue(job(id, "server-a"));
		await flush();

		// Before the drain loop, one enqueue started at most one job.
		expect(started.sort()).toEqual(["a1", "a2", "a3"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 2, running: 3 });

		await finish("a1");
		expect(started).toContain("a4");
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 3 });
	});

	it("raising the concurrency of a backed-up server starts the extra jobs at once", async () => {
		const { runner, started } = controlledRunner();
		queue.setJobRunner(runner);

		for (const id of ["a1", "a2", "a3", "a4"]) queue.enqueue(job(id, "server-a"));
		await flush();
		expect(started).toEqual(["a1"]);

		queue.setServerConcurrency("server-a", 3);
		await flush();
		expect(started.sort()).toEqual(["a1", "a2", "a3"]);
	});

	it("cancels a pending job so it never runs", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("j1"));
		queue.enqueue(job("j2"));
		await flush();

		expect(queue.requestCancellation("j2")).toBe("pending");
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 1 });

		await finish("j1");
		expect(started).toEqual(["j1"]);
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});

	it("cancels a running job by killing its registered processes", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("j1"));
		await flush();

		const proc = { kill: vi.fn(), done: new Promise<void>(() => {}) };
		queue.registerDeploymentProcess("j1", proc);

		expect(queue.requestCancellation("j1")).toBe("running");
		expect(proc.kill).toHaveBeenCalledTimes(1);
		expect(queue.isDeploymentCancelled("j1")).toBe(true);
		expect(queue.getCancellationReason("j1")).toBe("user");

		// After the worker settles, the cancellation marker is cleaned up.
		await finish("j1");
		expect(queue.isDeploymentCancelled("j1")).toBe(false);
		expect(queue.getCancellationReason("j1")).toBeNull();
	});

	it("returns null when cancelling an unknown deployment", async () => {
		queue.setJobRunner(vi.fn());
		expect(queue.requestCancellation("nope")).toBeNull();
	});

	it("survives a rejected runner promise and keeps draining", async () => {
		const started: string[] = [];
		queue.setJobRunner((j) => {
			started.push(j.deploymentId);
			return j.deploymentId === "j1" ? Promise.reject(new Error("boom")) : Promise.resolve();
		});

		queue.enqueue(job("j1"));
		queue.enqueue(job("j2"));
		await flush();

		expect(started).toEqual(["j1", "j2"]);
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});

	it("removes a process whose done promise rejects, without an unhandled rejection", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("j1"));
		await flush();

		let rejectDone!: (error: Error) => void;
		const proc = {
			kill: vi.fn(),
			done: new Promise<void>((_, reject) => {
				rejectDone = reject;
			}),
		};
		queue.registerDeploymentProcess("j1", proc);

		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			rejectDone(new Error("build failed"));
			// Let the rejection (and any unhandled-rejection event) settle.
			await flush();
			await flush();

			expect(unhandled).toEqual([]);

			// The rejected process was removed from the tracked set: cancelling
			// the deployment must not try to kill it again.
			expect(queue.requestCancellation("j1")).toBe("running");
			expect(proc.kill).not.toHaveBeenCalled();

			await finish("j1");
		} finally {
			process.removeListener("unhandledRejection", onUnhandled);
		}
	});
});

describe("coalescing and per-app mutex", () => {
	it("supersedes a pending job for the same app so a push burst queues one build", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);

		expect(queue.enqueue(job("d1", null, "shop")).superseded).toEqual([]);
		await flush();
		// d1 is running; d2 waits.
		expect(queue.enqueue(job("d2", null, "shop")).superseded).toEqual([]);
		// d3 replaces d2 (still pending); d1 keeps running.
		const { superseded } = queue.enqueue(job("d3", null, "shop"));
		expect(superseded.map((j) => j.deploymentId)).toEqual(["d2"]);
		expect(queue.queueDepth(null)).toEqual({ pending: 1, running: 1 });
		expect(queue.getQueuePosition("d3")).toBe(1);
		expect(queue.getQueuePosition("d2")).toBeNull();

		await finish("d1");
		expect(started).toEqual(["d1", "d3"]);
	});

	it("never runs two jobs for one app concurrently, even with spare concurrency", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 2);

		queue.enqueue(job("x1", "server-a", "app-x"));
		queue.enqueue(job("x2", "server-a", "app-x"));
		queue.enqueue(job("y1", "server-a", "app-y"));
		await flush();

		// x2 is skipped (app-x busy); y1 takes the free slot instead.
		expect(started.sort()).toEqual(["x1", "y1"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 2 });

		await finish("x1");
		expect(started).toEqual(["x1", "y1", "x2"]);
	});

	it("reports 1-based queue positions per server line", async () => {
		const { runner } = controlledRunner();
		queue.setJobRunner(runner);

		queue.enqueue(job("j1"));
		queue.enqueue(job("j2"));
		queue.enqueue(job("j3"));
		queue.enqueue(job("b1", "server-b"));
		await flush();

		expect(queue.getQueuePosition("j1")).toBeNull(); // running
		expect(queue.getQueuePosition("j2")).toBe(1);
		expect(queue.getQueuePosition("j3")).toBe(2);
		expect(queue.getQueuePosition("b1")).toBeNull(); // running on its own server
	});
});

describe("shared state across module instances", () => {
	it("lets a second instance (custom server vs Next bundle) see and drain the first one's jobs", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.enqueue(job("a"));
		queue.enqueue(job("b"));
		await flush();
		expect(started).toEqual(["a"]);

		// Same file, second evaluation — what server.ts gets under tsx while
		// the tRPC route bundle holds its own copy.
		vi.resetModules();
		const other = await import("./queue");
		expect(other).not.toBe(queue);
		expect(other.queueDepth(null)).toEqual({ pending: 1, running: 1 });
		expect(other.getQueuePosition("b")).toBe(1);

		const drained = other.drainQueue({ graceMs: 1_000 });
		expect(queue.isQueueDraining()).toBe(true);
		await finish("a");
		await expect(drained).resolves.toEqual({ completed: 1, interrupted: 0 });
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});
});

describe("cancellation reasons and hooks", () => {
	it("keeps the first reason and fires cancellation hooks", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.enqueue(job("j1"));
		await flush();

		const hook = vi.fn();
		const unsubscribe = queue.onDeploymentCancelled("j1", hook);
		expect(queue.requestCancellation("j1", "timeout")).toBe("running");
		expect(hook).toHaveBeenCalledTimes(1);
		expect(queue.getCancellationReason("j1")).toBe("timeout");

		// A later user cancel does not rewrite the reason.
		queue.requestCancellation("j1", "user");
		expect(queue.getCancellationReason("j1")).toBe("timeout");
		unsubscribe();

		// A hook registered after the fact runs immediately.
		const late = vi.fn();
		queue.onDeploymentCancelled("j1", late);
		expect(late).toHaveBeenCalledTimes(1);

		await finish("j1");
	});
});

describe("drainQueue", () => {
	it("resolves at once when nothing is running and drops the pending backlog", async () => {
		const { runner, started } = controlledRunner();
		queue.setJobRunner(runner);
		await expect(queue.drainQueue({ graceMs: 10 })).resolves.toEqual({
			completed: 0,
			interrupted: 0,
		});
		expect(queue.isQueueDraining()).toBe(true);

		// Nothing starts once draining — the row stays queued for boot recovery.
		queue.enqueue(job("late"));
		await flush();
		expect(started).toEqual([]);
	});

	it("waits for a job that finishes inside the grace", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.enqueue(job("j1"));
		queue.enqueue(job("j2"));
		await flush();

		const drained = queue.drainQueue({ graceMs: 1_000 });
		expect(queue.queueDepth(null).pending).toBe(0);
		await finish("j1");
		await expect(drained).resolves.toEqual({ completed: 1, interrupted: 0 });
	});

	it("cancels stragglers with reason shutdown once the grace expires", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.enqueue(job("j1"));
		await flush();

		const proc = { kill: vi.fn(), done: new Promise<void>(() => {}) };
		queue.registerDeploymentProcess("j1", proc);
		// The worker finalizes and returns once it observes the cancel.
		let reason: string | null = null;
		queue.onDeploymentCancelled("j1", () => {
			reason = queue.getCancellationReason("j1");
			void finish("j1");
		});

		const result = await queue.drainQueue({ graceMs: 20 });
		expect(proc.kill).toHaveBeenCalledTimes(1);
		expect(reason).toBe("shutdown");
		expect(result).toEqual({ completed: 0, interrupted: 1 });
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});
});
