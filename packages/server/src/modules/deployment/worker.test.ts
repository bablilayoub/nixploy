import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for preview-job status bookkeeping in the deploy worker:
 * - a failed preview must set previewDeployments.previewStatus = "error"
 *   (before the fix it stayed "running" forever);
 * - a cancelled preview must set it back to "idle";
 * - preview jobs must never touch the PARENT application's status.
 */

const { updates, deploymentRow } = vi.hoisted(() => ({
	updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
	deploymentRow: {
		value: null as null | { deploymentId: string; status: string; logPath: string },
	},
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			deployments: { findFirst: async () => deploymentRow.value },
			// No application row → the job fails fast, exercising the catch path.
			applications: { findFirst: async () => undefined },
			previewDeployments: { findFirst: async () => null },
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
	resyncComposeDomains: vi.fn(async () => {}),
}));

import type { QueueJob } from "./queue";

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
});
