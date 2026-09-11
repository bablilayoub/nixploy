import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the deploy worker's status bookkeeping:
 * - a failed preview must set previewDeployments.previewStatus = "error"
 *   (before the fix it stayed "running" forever);
 * - a cancelled preview must set it back to "idle";
 * - preview jobs must never touch the PARENT application's status;
 * - a failure BEFORE the log is opened (DB error, unwritable log dir) must
 *   still finalize the row and emit `finish`;
 * - a job stuck in a step that is not process-bound still finalizes when it
 *   hits its deadline, is cancelled by the user, or interrupted by shutdown.
 */

const { updates, deploymentRow, applicationLookup } = vi.hoisted(() => ({
	updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
	deploymentRow: {
		value: null as null | { deploymentId: string; status: string; logPath: string },
		/** Thrown once by the next deployments.findFirst call. */
		error: null as null | Error,
	},
	/** When set, applications.findFirst never resolves (simulates a hung DB/SSH step). */
	applicationLookup: { hang: false },
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			deployments: {
				findFirst: async () => {
					if (deploymentRow.error) {
						const error = deploymentRow.error;
						deploymentRow.error = null;
						throw error;
					}
					return deploymentRow.value;
				},
			},
			// No application row → the job fails fast, exercising the catch path.
			applications: {
				findFirst: () =>
					applicationLookup.hang ? new Promise<never>(() => {}) : Promise.resolve(undefined),
			},
			previewDeployments: { findFirst: async () => null },
			compose: { findFirst: async () => undefined },
		},
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => {
				const name =
					(table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown";
				updates.push({ table: String(name), values });
				return { where: async () => [] as unknown[] };
			},
		}),
	},
}));

vi.mock("./logger", () => ({
	DeploymentLogger: class {
		constructor(readonly logPath: string) {}
		addSecret(): void {}
		listSecrets(): readonly string[] {
			return [];
		}
		write(): void {}
		line(): void {}
		close(): void {}
	},
}));

// Owned by another module — stub so the test does not depend on it.
vi.mock("../compose/service", () => ({
	prepareComposeFiles: vi.fn(),
	buildComposeDeployCommand: vi.fn(() => "true"),
	resyncComposeDomains: vi.fn(async () => {}),
}));

import type { QueueJob } from "./queue";
import type { ApplicationRow } from "./sources";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const job = (deploymentId: string, previewDeploymentId: string): QueueJob => ({
	deploymentId,
	appName: "parent-app",
	applicationId: "parent-app-1",
	previewDeploymentId,
	type: "deploy",
	serverId: null,
});

const terminalUpdate = () => updates.find((u) => u.table === "deployment" && "status" in u.values);

describe("worker preview status bookkeeping", () => {
	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = false;
		deploymentRow.value = { deploymentId: "d1", status: "running", logPath: "/tmp/test.log" };
	});

	it("does not re-write the status the claim query already set", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-claim", status: "running", logPath: "/tmp/c.log" };
		queue.startJob("__local__", job("d-claim", "prev-0"));
		await flush();
		await flush();

		// The row arrives already `running` (claimed atomically in SQL); the
		// worker only writes the TERMINAL status.
		const statusUpdates = updates
			.filter((u) => u.table === "deployment" && "status" in u.values)
			.map((u) => u.values.status);
		expect(statusUpdates).toEqual(["error"]);
	});

	it("skips a row that is no longer running (cancelled or superseded while waiting)", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-gone", status: "cancelled", logPath: "/tmp/g.log" };
		queue.startJob("__local__", job("d-gone", "prev-0"));
		await flush();
		await flush();

		expect(updates).toEqual([]);
	});

	it("marks a failed preview as error and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-fail", status: "running", logPath: "/tmp/f.log" };
		queue.startJob("__local__", job("d-fail", "prev-1"));
		await flush();
		await flush();

		const previewUpdates = updates.filter((u) => u.table === "preview_deployment");
		expect(previewUpdates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "error" },
		});

		// The parent application row must never be updated for preview jobs.
		expect(updates.filter((u) => u.table === "application")).toEqual([]);

		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("error");
	});

	it("marks a cancelled preview as idle and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-cancel", status: "running", logPath: "/tmp/c.log" };
		queue.startJob("__local__", job("d-cancel", "prev-2"));
		// The drain loop marks the job running synchronously, so this cancels it.
		queue.requestCancellation("d-cancel");
		await flush();
		await flush();

		const previewUpdates = updates.filter((u) => u.table === "preview_deployment");
		expect(previewUpdates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "idle" },
		});
		expect(updates.filter((u) => u.table === "application")).toEqual([]);

		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("cancelled");
	});

	it("finalizes the row and emits finish when the job dies before its log opens", async () => {
		const queue = await import("./queue");
		await import("./worker");
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);
		try {
			deploymentRow.error = new Error("database unavailable");
			queue.startJob("__local__", {
				deploymentId: "d-early",
				appName: "app-one",
				applicationId: "app-1",
				type: "deploy",
				serverId: null,
			});
			await flush();
			await flush();

			const terminal = terminalUpdate();
			expect(terminal?.values.status).toBe("error");
			expect(terminal?.values.errorMessage).toBe("database unavailable");
			expect(finished).toContainEqual({ deploymentId: "d-early", status: "error" });
			// A non-preview job failing marks the application as errored.
			expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
				status: "error",
			});
		} finally {
			deploymentEvents.off("finish", onFinish);
		}
	});
});

describe("worker deadlines and interruption", () => {
	const hungJob = (deploymentId: string): QueueJob => ({
		deploymentId,
		appName: "hung-app",
		applicationId: "app-hung",
		type: "deploy",
		serverId: null,
	});

	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = true;
		delete process.env.NIXPLOY_DEPLOY_TIMEOUT_MS;
	});

	it("fails a job that exceeds NIXPLOY_DEPLOY_TIMEOUT_MS even while stuck in a non-process await", async () => {
		process.env.NIXPLOY_DEPLOY_TIMEOUT_MS = "40";
		const queue = await import("./queue");
		await import("./worker");
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);
		try {
			deploymentRow.value = { deploymentId: "d-slow", status: "running", logPath: "/tmp/s.log" };
			queue.startJob("__local__", hungJob("d-slow"));
			await sleep(150);

			const terminal = terminalUpdate();
			expect(terminal?.values.status).toBe("error");
			expect(terminal?.values.errorMessage).toMatch(/^Deployment exceeded /);
			expect(finished).toContainEqual({ deploymentId: "d-slow", status: "error" });
			// The slot is free again: the queue does not think the job is still running.
			expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
		} finally {
			deploymentEvents.off("finish", onFinish);
			delete process.env.NIXPLOY_DEPLOY_TIMEOUT_MS;
		}
	});

	it("finalizes a hung job as error 'Interrupted by panel shutdown' when drained", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-shut", status: "running", logPath: "/tmp/sh.log" };
		queue.startJob("__local__", hungJob("d-shut"));
		await flush();

		const result = await queue.drainQueue({ graceMs: 20 });
		expect(result).toEqual({ completed: 0, interrupted: 1 });
		const terminal = terminalUpdate();
		expect(terminal?.values).toMatchObject({
			status: "error",
			errorMessage: "Interrupted by panel shutdown",
		});
		expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
			status: "error",
		});
	});

	it("finalizes a hung job as cancelled on a user cancel", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-user", status: "running", logPath: "/tmp/u.log" };
		queue.startJob("__local__", hungJob("d-user"));
		await flush();
		expect(queue.requestCancellation("d-user")).toBe("running");
		await flush();
		await flush();

		const terminal = terminalUpdate();
		expect(terminal?.values).toMatchObject({ status: "cancelled", errorMessage: null });
		expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
			status: "idle",
		});
	});
});

describe("buildPreviewDeployTarget", () => {
	const application = {
		appName: "myapp",
		owner: "acme",
		repository: "app",
		branch: "main",
		gitBranch: null,
	} as unknown as ApplicationRow;

	it("keeps the parent repo for same-repo PRs and fetches PR refs for forks", async () => {
		const { buildPreviewDeployTarget } = await import("./worker");
		expect(
			buildPreviewDeployTarget(application, { appName: "myapp-pr-3", branch: "feat" }),
		).toMatchObject({
			appName: "myapp-pr-3",
			owner: "acme",
			repository: "app",
			branch: "feat",
			gitBranch: "feat",
		});
		expect(
			buildPreviewDeployTarget(application, { appName: "myapp-pr-3", branch: "refs/pull/3/head" }),
		).toMatchObject({ owner: "acme", repository: "app", branch: "refs/pull/3/head" });
	});

	it("clones the fork repository for Bitbucket fork PRs", async () => {
		const { buildPreviewDeployTarget } = await import("./worker");
		expect(
			buildPreviewDeployTarget(application, {
				appName: "myapp-pr-3",
				branch: "fork:forker/app:fix",
			}),
		).toMatchObject({ owner: "forker", repository: "app", branch: "fix", gitBranch: "fix" });
	});
});

describe("describeDeadline", () => {
	it("prints minutes for minute-scale budgets and seconds otherwise", async () => {
		const { describeDeadline } = await import("./worker");
		expect(describeDeadline(60 * 60 * 1000)).toBe("60 minutes");
		expect(describeDeadline(90 * 1000)).toBe("2 minutes");
		expect(describeDeadline(30 * 1000)).toBe("30 seconds");
		expect(describeDeadline(40)).toBe("1 seconds");
	});
});
