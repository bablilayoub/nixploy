import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the deploy worker's status bookkeeping:
 * - a failed preview must set previewDeployments.previewStatus = "error"
 *   (before the fix it stayed "running" forever);
 * - a cancelled preview must set it back to "idle";
 * - preview jobs must never touch the PARENT application's status;
 * - a failure BEFORE the log is opened (DB error, unwritable log dir) must
 *   still finalize the row and emit `finish`.
 */

const { updates, deploymentRow } = vi.hoisted(() => ({
	updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
	deploymentRow: {
		value: null as null | { deploymentId: string; status: string; logPath: string },
		/** Thrown once by the next deployments.findFirst call. */
		error: null as null | Error,
	},
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
			applications: { findFirst: async () => undefined },
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

const job = (deploymentId: string, previewDeploymentId: string): QueueJob => ({
	deploymentId,
	applicationId: "parent-app-1",
	previewDeploymentId,
	type: "deploy",
	serverId: null,
});

describe("worker preview status bookkeeping", () => {
	beforeEach(async () => {
		vi.resetModules();
		updates.length = 0;
		deploymentRow.error = null;
		deploymentRow.value = { deploymentId: "d1", status: "running", logPath: "/tmp/test.log" };
	});

	it("marks a failed preview as error and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-fail", status: "running", logPath: "/tmp/f.log" };
		queue.enqueue(job("d-fail", "prev-1"));
		await flush();
		await flush();

		const previewUpdates = updates.filter((u) => u.table === "preview_deployment");
		expect(previewUpdates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "error" },
		});

		// The parent application row must never be updated for preview jobs.
		expect(updates.filter((u) => u.table === "application")).toEqual([]);

		const terminal = updates.find((u) => u.table === "deployment" && "status" in u.values);
		expect(terminal?.values.status).toBe("error");
	});

	it("marks a cancelled preview as idle and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-cancel", status: "running", logPath: "/tmp/c.log" };
		queue.enqueue(job("d-cancel", "prev-2"));
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

		const terminal = updates.find((u) => u.table === "deployment" && "status" in u.values);
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
			queue.enqueue({
				deploymentId: "d-early",
				applicationId: "app-1",
				type: "deploy",
				serverId: null,
			});
			await flush();
			await flush();

			const terminal = updates.find((u) => u.table === "deployment" && "status" in u.values);
			expect(terminal?.values.status).toBe("error");
			expect(
				updates.find((u) => u.table === "deployment" && "errorMessage" in u.values)?.values
					.errorMessage,
			).toBe("database unavailable");
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
