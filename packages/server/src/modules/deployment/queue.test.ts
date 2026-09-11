import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueJob } from "./queue";

/**
 * Durable-queue unit tests.
 *
 * The queue's ordering rules live in one SQL statement, so this suite runs
 * against a fake `db.execute` that models that statement's semantics: FIFO
 * per server, the `NOT EXISTS … status = 'running'` per-app mutex, the
 * `blocked` id list and the `row_number()` position snapshot. The real
 * statement (and `FOR UPDATE SKIP LOCKED` under concurrency) is exercised
 * against Postgres in `queue.db.test.ts`.
 */

interface FakeRow {
	deploymentId: string;
	appName: string;
	serverId: string | null;
	status: "queued" | "running" | "done" | "cancelled";
	createdAt: number;
	isPreview: boolean;
}

const { table } = vi.hoisted(() => ({ table: { rows: [] as FakeRow[] } }));

/** Flatten a drizzle `SQL` into its literal text and its bound parameters. */
const { readSql } = vi.hoisted(() => {
	// drizzle keeps literal text in `StringChunk` objects and interpolated
	// values as raw entries; nested `sql` fragments carry their own chunks.
	const walk = (node: unknown, text: string[], params: unknown[]): void => {
		if (node !== null && typeof node === "object") {
			const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
			if (Array.isArray(chunks)) {
				for (const chunk of chunks) walk(chunk, text, params);
				return;
			}
			const value = (node as { value?: unknown }).value;
			// `sql.param(x)` wraps a value (arrays included) in a Param.
			if (Object.hasOwn(node, "encoder")) {
				params.push(value);
				return;
			}
			if (!Array.isArray(node) && Array.isArray(value)) {
				text.push(value.join(""));
				return;
			}
		}
		params.push(node);
	};
	return {
		readSql: (query: unknown) => {
			const text: string[] = [];
			const params: unknown[] = [];
			walk(query, text, params);
			return { text: text.join(" "), params };
		},
	};
});

vi.mock("../../db", () => ({
	db: {
		execute: async (query: unknown) => {
			const { text, params } = readSql(query);
			if (text.includes("row_number()")) {
				const queued = table.rows
					.filter((row) => row.status === "queued")
					.sort(
						(a, b) => a.createdAt - b.createdAt || a.deploymentId.localeCompare(b.deploymentId),
					);
				const seen = new Map<string, number>();
				return queued.map((row) => {
					const key = row.serverId ?? "__local__";
					const pos = (seen.get(key) ?? 0) + 1;
					seen.set(key, pos);
					return { deployment_id: row.deploymentId, server_id: row.serverId, pos };
				});
			}
			if (text.includes(`set "status" = 'running'`)) {
				const [serverId, blocked] = params as [string | null, string[]];
				const busy = new Set(
					table.rows.filter((row) => row.status === "running").map((row) => row.appName),
				);
				const candidate = table.rows
					.filter(
						(row) =>
							row.status === "queued" &&
							row.serverId === (serverId ?? null) &&
							!blocked.includes(row.deploymentId) &&
							!busy.has(row.appName),
					)
					.sort(
						(a, b) => a.createdAt - b.createdAt || a.deploymentId.localeCompare(b.deploymentId),
					)[0];
				if (!candidate) return [];
				candidate.status = "running";
				return [
					{
						deployment_id: candidate.deploymentId,
						application_id: `app-${candidate.appName}`,
						compose_id: null,
						is_preview: candidate.isPreview,
						title: "Deployment",
						server_id: candidate.serverId,
						app_name: candidate.appName,
					},
				];
			}
			return [];
		},
	},
}));

type QueueModule = typeof import("./queue");
let queue: QueueModule;

/** Both the queue state and the event bus live on globalThis — drop both. */
const resetGlobals = () => {
	const g = globalThis as {
		__nixployDeploymentQueue?: unknown;
		__nixployDeploymentEvents?: unknown;
	};
	g.__nixployDeploymentQueue = undefined;
	g.__nixployDeploymentEvents = undefined;
};

let clock = 0;
const enqueueRow = (
	deploymentId: string,
	appName: string,
	serverId: string | null = null,
	isPreview = false,
): void => {
	table.rows.push({
		deploymentId,
		appName,
		serverId,
		status: "queued",
		createdAt: ++clock,
		isPreview,
	});
};

/** Let the claim loop (async, timer-driven) reach a fixed point. */
const settle = async (rounds = 8): Promise<void> => {
	for (let index = 0; index < rounds; index++) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
};

interface Deferred {
	resolve: () => void;
}

/** A mock runner whose completions the test controls explicitly. */
function controlledRunner() {
	const started: string[] = [];
	const gates = new Map<string, Deferred>();
	const runner = vi.fn((job: QueueJob) => {
		started.push(job.deploymentId);
		return new Promise<void>((resolve) => {
			gates.set(job.deploymentId, { resolve: () => resolve() });
		});
	});
	/** Finish a job the way the worker does: finalize the row, then return. */
	const finish = async (deploymentId: string) => {
		const row = table.rows.find((entry) => entry.deploymentId === deploymentId);
		if (row) row.status = "done";
		gates.get(deploymentId)?.resolve();
		await settle();
	};
	return { runner, started, finish };
}

beforeEach(async () => {
	vi.resetModules();
	resetGlobals();
	table.rows = [];
	clock = 0;
	queue = await import("./queue");
});

describe("durable queue: claiming", () => {
	it("claims rows for one server serially, oldest first", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		enqueueRow("j2", "app-2");
		enqueueRow("j3", "app-3");

		queue.startQueueLoop();
		await settle();

		// Default concurrency is 1: only the oldest row is claimed.
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
		enqueueRow("a1", "app-a1", "server-a");
		enqueueRow("a2", "app-a2", "server-a");
		enqueueRow("b1", "app-b1", "server-b");

		queue.startQueueLoop();
		await settle();

		expect([...started].sort()).toEqual(["a1", "b1"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 1 });
		expect(queue.queueDepth("server-b")).toEqual({ pending: 0, running: 1 });

		await finish("a1");
		expect(started).toContain("a2");
	});

	it("honors setServerConcurrency", async () => {
		const { runner, started } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 2);
		for (const id of ["a1", "a2", "a3"]) enqueueRow(id, `app-${id}`, "server-a");

		queue.startQueueLoop();
		await settle();

		expect([...started].sort()).toEqual(["a1", "a2"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 2 });
	});

	it("survives a rejected runner promise and keeps claiming", async () => {
		const started: string[] = [];
		queue.setJobRunner((job) => {
			started.push(job.deploymentId);
			const row = table.rows.find((entry) => entry.deploymentId === job.deploymentId);
			if (row) row.status = "done";
			return job.deploymentId === "j1" ? Promise.reject(new Error("boom")) : Promise.resolve();
		});
		enqueueRow("j1", "app-1");
		enqueueRow("j2", "app-2");

		queue.startQueueLoop();
		await settle();

		expect(started).toEqual(["j1", "j2"]);
		expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
	});
});

describe("durable queue: per-app mutex and positions", () => {
	it("never claims a second row for an app that is already building", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 2);
		enqueueRow("x1", "app-x", "server-a");
		enqueueRow("x2", "app-x", "server-a");
		enqueueRow("y1", "app-y", "server-a");

		queue.startQueueLoop();
		await settle();

		// x2 is skipped (app-x is building); y1 takes the free slot instead.
		expect([...started].sort()).toEqual(["x1", "y1"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 2 });

		await finish("x1");
		expect(started).toEqual(["x1", "y1", "x2"]);
	});

	it("blocks a queued preview whose real service name is already building", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		queue.setServerConcurrency("server-a", 2);
		// Both rows carry the PARENT application, so SQL cannot tell them
		// apart — the registry's appName does.
		enqueueRow("p1", "parent", "server-a", true);
		enqueueRow("p2", "parent", "server-a", true);
		queue.rememberJobDetails("p1", { appName: "parent-pr-7", type: "deploy" });
		queue.rememberJobDetails("p2", { appName: "parent-pr-7", type: "deploy" });

		queue.startQueueLoop();
		await settle();

		expect(started).toEqual(["p1"]);
		expect(queue.queueDepth("server-a")).toEqual({ pending: 1, running: 1 });

		await finish("p1");
		expect(started).toEqual(["p1", "p2"]);
	});

	it("reports 1-based queue positions per server line", async () => {
		const { runner } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		enqueueRow("j2", "app-2");
		enqueueRow("j3", "app-3");
		enqueueRow("b1", "app-b", "server-b");

		queue.startQueueLoop();
		await settle();

		expect(queue.getQueuePosition("j1")).toBeNull(); // running
		expect(queue.getQueuePosition("j2")).toBe(1);
		expect(queue.getQueuePosition("j3")).toBe(2);
		expect(queue.getQueuePosition("b1")).toBeNull(); // running on its own server
	});

	it("exposes the preview appName and preview id from the registry", async () => {
		const { runner } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("p1", "parent", null, true);
		queue.rememberJobDetails("p1", {
			appName: "parent-pr-3",
			previewDeploymentId: "prev-3",
			type: "redeploy",
		});

		const job = await queue.claimNextDeployment(null, []);
		expect(job).toMatchObject({
			deploymentId: "p1",
			appName: "parent-pr-3",
			previewDeploymentId: "prev-3",
			type: "redeploy",
		});
	});
});

describe("durable queue: cancellation", () => {
	it("cancels a running job by killing its registered processes", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		queue.startQueueLoop();
		await settle();

		const proc = { kill: vi.fn(), done: new Promise<void>(() => {}) };
		queue.registerDeploymentProcess("j1", proc);

		expect(queue.requestCancellation("j1")).toBe("running");
		expect(proc.kill).toHaveBeenCalledTimes(1);
		expect(queue.isDeploymentCancelled("j1")).toBe(true);
		expect(queue.getCancellationReason("j1")).toBe("user");

		await finish("j1");
		expect(queue.isDeploymentCancelled("j1")).toBe(false);
		expect(queue.getCancellationReason("j1")).toBeNull();
	});

	it("returns null when cancelling a deployment that is not running here", async () => {
		queue.setJobRunner(vi.fn());
		expect(queue.requestCancellation("nope")).toBeNull();
	});

	it("keeps the first reason and fires cancellation hooks", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		queue.startQueueLoop();
		await settle();

		const hook = vi.fn();
		const unsubscribe = queue.onDeploymentCancelled("j1", hook);
		expect(queue.requestCancellation("j1", "timeout")).toBe("running");
		expect(hook).toHaveBeenCalledTimes(1);
		expect(queue.getCancellationReason("j1")).toBe("timeout");

		queue.requestCancellation("j1", "user");
		expect(queue.getCancellationReason("j1")).toBe("timeout");
		unsubscribe();

		const late = vi.fn();
		queue.onDeploymentCancelled("j1", late);
		expect(late).toHaveBeenCalledTimes(1);

		await finish("j1");
	});

	it("removes a process whose done promise rejects, without an unhandled rejection", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		queue.startQueueLoop();
		await settle();

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
			await settle(2);

			expect(unhandled).toEqual([]);
			expect(queue.requestCancellation("j1")).toBe("running");
			expect(proc.kill).not.toHaveBeenCalled();

			await finish("j1");
		} finally {
			process.removeListener("unhandledRejection", onUnhandled);
		}
	});
});

describe("durable queue: shared state across module instances", () => {
	it("lets a second instance (custom server vs Next bundle) see and drain the first one's jobs", async () => {
		const { runner, started, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("a", "app-a");
		enqueueRow("b", "app-b");
		queue.startQueueLoop();
		await settle();
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
		expect(queue.queueDepth(null).running).toBe(0);
	});
});

describe("durable queue: drainQueue", () => {
	it("resolves at once when nothing is running and stops claiming", async () => {
		const { runner, started } = controlledRunner();
		queue.setJobRunner(runner);
		await expect(queue.drainQueue({ graceMs: 10 })).resolves.toEqual({
			completed: 0,
			interrupted: 0,
		});
		expect(queue.isQueueDraining()).toBe(true);

		// Nothing starts once draining — the row stays queued for the next boot.
		enqueueRow("late", "app-late");
		queue.startQueueLoop();
		await settle();
		expect(started).toEqual([]);
		expect(table.rows[0]?.status).toBe("queued");
	});

	it("waits for a job that finishes inside the grace and leaves the backlog queued", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		enqueueRow("j2", "app-2");
		queue.startQueueLoop();
		await settle();

		const drained = queue.drainQueue({ graceMs: 1_000 });
		await finish("j1");
		await expect(drained).resolves.toEqual({ completed: 1, interrupted: 0 });
		// j2 was never claimed: it is still `queued` for the next process.
		expect(table.rows.find((row) => row.deploymentId === "j2")?.status).toBe("queued");
	});

	it("cancels stragglers with reason shutdown once the grace expires", async () => {
		const { runner, finish } = controlledRunner();
		queue.setJobRunner(runner);
		enqueueRow("j1", "app-1");
		queue.startQueueLoop();
		await settle();

		const proc = { kill: vi.fn(), done: new Promise<void>(() => {}) };
		queue.registerDeploymentProcess("j1", proc);
		let reason: string | null = null;
		queue.onDeploymentCancelled("j1", () => {
			reason = queue.getCancellationReason("j1");
			void finish("j1");
		});

		const result = await queue.drainQueue({ graceMs: 20 });
		expect(proc.kill).toHaveBeenCalledTimes(1);
		expect(reason).toBe("shutdown");
		expect(result).toEqual({ completed: 0, interrupted: 1 });
	});
});
