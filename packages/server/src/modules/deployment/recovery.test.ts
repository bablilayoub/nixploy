import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boot recovery: `running` rows are failed (the build died with the old
 * process), `queued` rows are put back on the queue oldest-first, and two
 * queued rows for one app collapse to the newest (coalescing).
 */

const { state } = vi.hoisted(() => ({
	state: {
		updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
		queued: [] as Array<Record<string, unknown>>,
		/** Rows returned by successive `deployment` updates that use `.returning()`. */
		returning: [] as Array<Array<Record<string, unknown>>>,
	},
}));

vi.mock("../../db", () => {
	const tableName = (table: unknown) =>
		String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");
	return {
		db: {
			query: {
				deployments: { findMany: async () => state.queued },
			},
			update: (table: unknown) => ({
				set: (values: Record<string, unknown>) => {
					state.updates.push({ table: tableName(table), values });
					return {
						where: () => {
							const rows = tableName(table) === "deployment" ? (state.returning.shift() ?? []) : [];
							const promise = Promise.resolve(rows);
							return Object.assign(promise, { returning: async () => rows });
						},
					};
				},
			}),
		},
	};
});

// The real worker drags the whole build pipeline in; the queue only needs a runner.
vi.mock("./worker", () => ({}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const queuedRow = (
	deploymentId: string,
	appName: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	deploymentId,
	title: "Deployment",
	applicationId: `app-${appName}`,
	composeId: null,
	isPreview: false,
	application: { appName, serverId: null },
	compose: null,
	...extra,
});

describe("recoverInterruptedDeployments", () => {
	beforeEach(() => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		state.updates.length = 0;
		state.queued.length = 0;
		state.returning.length = 0;
	});

	it("fails running rows, re-enqueues queued rows in order and coalesces per app", async () => {
		const queue = await import("./queue");
		const started: string[] = [];
		queue.setJobRunner(
			(job) =>
				new Promise<void>(() => {
					started.push(job.deploymentId);
				}),
		);
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);

		state.returning.push(
			// 1. running → error
			[{ deploymentId: "r1", applicationId: "app-one", composeId: null, isPreview: false }],
			// 2. queued previews → error
			[{ deploymentId: "p1" }],
			// 3. supersede of q3 by q4 (same app)
			[{ deploymentId: "q3" }],
		);
		state.queued.push(
			queuedRow("q1", "one"),
			queuedRow("q2", "one", { title: "Redeploy" }),
			queuedRow("q3", "two"),
			queuedRow("q4", "two"),
		);

		try {
			const { recoverInterruptedDeployments } = await import("./recovery");
			const result = await recoverInterruptedDeployments();
			await flush();

			expect(result).toEqual({ interrupted: 2, requeued: 3 });
			// q1 runs; q2 waits behind it (same app, mutex); q4 replaced q3.
			expect(started).toEqual(["q1"]);
			expect(queue.queueDepth(null)).toEqual({ pending: 2, running: 1 });
			expect(queue.getQueuePosition("q2")).toBe(1);
			expect(queue.getQueuePosition("q4")).toBe(2);
			expect(queue.getQueuePosition("q3")).toBeNull();

			expect(state.updates[0]).toMatchObject({
				table: "deployment",
				values: { status: "error", errorMessage: expect.stringMatching(/^Interrupted/) },
			});
			expect(state.updates.filter((u) => u.table === "application")[0]?.values).toEqual({
				status: "error",
			});
			expect(state.updates.filter((u) => u.table === "preview_deployment")[0]?.values).toEqual({
				previewStatus: "error",
			});
			const superseded = state.updates.find((u) => u.values.status === "cancelled");
			expect(superseded?.values.errorMessage).toBe("Superseded by a newer deployment");

			expect(finished).toEqual(
				expect.arrayContaining([
					{ deploymentId: "r1", status: "error" },
					{ deploymentId: "p1", status: "error" },
					{ deploymentId: "q3", status: "cancelled" },
				]),
			);
		} finally {
			deploymentEvents.off("finish", onFinish);
		}
	});

	it("reports zero work on a clean boot", async () => {
		const queue = await import("./queue");
		queue.setJobRunner(async () => {});
		const { recoverInterruptedDeployments } = await import("./recovery");
		await expect(recoverInterruptedDeployments()).resolves.toEqual({
			interrupted: 0,
			requeued: 0,
		});
		expect(state.updates.filter((u) => u.table === "application")).toEqual([]);
	});
});
