import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueJob } from "./queue";

// The queue keeps module-level state, so every test gets a fresh module.
type QueueModule = typeof import("./queue");
let queue: QueueModule;

beforeEach(async () => {
	vi.resetModules();
	queue = await import("./queue");
});

/** Flush the microtask/promise chain the drain loop runs on. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const job = (deploymentId: string, serverId: string | null = null): QueueJob => ({
	deploymentId,
	type: "deploy",
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

		// After the worker settles, the cancellation marker is cleaned up.
		await finish("j1");
		expect(queue.isDeploymentCancelled("j1")).toBe(false);
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
