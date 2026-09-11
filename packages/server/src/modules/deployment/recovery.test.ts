import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boot recovery with the durable queue: `running` rows are failed (their build
 * died with the old process, and the per-app mutex would otherwise refuse to
 * ever rebuild that service) and queued rows the claim query can never place
 * (`app_name IS NULL`) are failed. Everything else — previews included since
 * migration 0023 — is simply left `queued` for the claim loop, which is what
 * makes the backlog survive a restart.
 */

const { state } = vi.hoisted(() => ({
	state: {
		updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
		/**
		 * Rows returned by the successive `deployment` updates, in order:
		 * [0] the `running` → error sweep, [1] the unplaceable-queued sweep.
		 */
		returning: [] as Array<Array<Record<string, unknown>>>,
		/** Rows the queue-position snapshot query reports. */
		queued: [] as Array<{ deployment_id: string; server_id: string | null; pos: number }>,
		loopStarted: 0,
	},
}));

vi.mock("../../db", () => {
	const tableName = (table: unknown) =>
		String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");
	return {
		db: {
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
			// Only used to build the `notExists` sub-select that spares previews
			// whose job is still waiting; the mocked `where` ignores it.
			select: () => ({ from: () => ({ where: () => ({}) }) }),
			execute: async () => state.queued,
		},
	};
});

vi.mock("./queue", async () => {
	const actual = await vi.importActual<typeof import("./queue")>("./queue");
	return {
		...actual,
		startQueueLoop: () => {
			state.loopStarted += 1;
		},
	};
});

describe("recoverInterruptedDeployments", () => {
	beforeEach(() => {
		vi.resetModules();
		const globals = globalThis as {
			__nixployDeploymentQueue?: unknown;
			__nixployDeploymentEvents?: unknown;
		};
		globals.__nixployDeploymentQueue = undefined;
		globals.__nixployDeploymentEvents = undefined;
		state.updates.length = 0;
		state.returning.length = 0;
		state.queued.length = 0;
		state.loopStarted = 0;
	});

	it("fails interrupted and unplaceable rows, leaves the backlog queued and starts the loop", async () => {
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);

		state.returning.push(
			// 1. running → error
			[{ deploymentId: "r1", applicationId: "app-one", composeId: null, isPreview: false }],
			// 2. queued rows with no app_name → error
			[{ deploymentId: "o1" }],
		);
		state.queued.push(
			{ deployment_id: "q1", server_id: null, pos: 1 },
			{ deployment_id: "q2", server_id: null, pos: 2 },
			{ deployment_id: "q3", server_id: "server-a", pos: 1 },
		);

		try {
			const { recoverInterruptedDeployments } = await import("./recovery");
			const result = await recoverInterruptedDeployments();

			expect(result).toEqual({ interrupted: 1, requeued: 3 });
			expect(state.loopStarted).toBe(1);

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

			// The queued backlog is now readable through the SQL snapshot.
			const queue = await import("./queue");
			expect(queue.getQueuePosition("q2")).toBe(2);
			expect(queue.queueDepth(null)).toEqual({ pending: 2, running: 0 });
			expect(queue.queueDepth("server-a").pending).toBe(1);

			expect(finished).toEqual(
				expect.arrayContaining([
					{ deploymentId: "r1", status: "error" },
					{ deploymentId: "o1", status: "error" },
				]),
			);
		} finally {
			deploymentEvents.off("finish", onFinish);
		}
	});

	it("never fails a queued row just because it is a preview", async () => {
		const { deploymentEvents } = await import("./events");
		const finished: string[] = [];
		const onFinish = (event: { deploymentId: string }) => {
			finished.push(event.deploymentId);
		};
		deploymentEvents.on("finish", onFinish);
		try {
			// Nothing was running and nothing is unplaceable: both sweeps return
			// empty even though a queued preview is waiting.
			state.queued.push({ deployment_id: "prev-1", server_id: null, pos: 1 });

			const { recoverInterruptedDeployments } = await import("./recovery");
			expect(await recoverInterruptedDeployments()).toEqual({ interrupted: 0, requeued: 1 });
			expect(finished).toEqual([]);

			// The row is in the claim loop's line, not in an error state.
			const queue = await import("./queue");
			expect(queue.getQueuePosition("prev-1")).toBe(1);
		} finally {
			deploymentEvents.off("finish", onFinish);
		}
	});

	it("reports zero work on a clean boot", async () => {
		const { recoverInterruptedDeployments } = await import("./recovery");
		await expect(recoverInterruptedDeployments()).resolves.toEqual({
			interrupted: 0,
			requeued: 0,
		});
		expect(state.updates.filter((u) => u.table === "application")).toEqual([]);
		expect(state.loopStarted).toBe(1);
	});
});
