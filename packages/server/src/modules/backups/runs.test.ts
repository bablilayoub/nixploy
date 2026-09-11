import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Run-history bookkeeping against a fake drizzle client: the row is
 * inserted as `running`, finalised as success/error, and the scope's
 * history is pruned — with the work's own outcome always winning.
 */

const state = vi.hoisted(() => ({
	inserted: [] as Array<Record<string, unknown>>,
	updates: [] as Array<Record<string, unknown>>,
	deleted: 0,
	stale: [] as Array<{ backupRunId: string }>,
	failFinish: false,
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	const chain = (result: () => unknown) => {
		const proxy: Record<string | symbol, unknown> = new Proxy(
			{},
			{
				get(_target, prop) {
					if (prop === "then") {
						return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
							Promise.resolve().then(result).then(resolve, reject);
					}
					return () => proxy;
				},
			},
		);
		return proxy;
	};
	const db = {
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				state.inserted.push(values);
				return { returning: async () => [{ backupRunId: `run-${state.inserted.length}` }] };
			},
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					if (state.failFinish) throw new Error("db down");
					state.updates.push(values);
				},
			}),
		}),
		select: () => chain(() => state.stale),
		delete: () => ({
			where: async () => {
				state.deleted += 1;
			},
		}),
	};
	return { ...actual, db, client: vi.fn() };
});

import { pruneBackupRuns, sanitizeRunError, withBackupRun } from "./runs";

beforeEach(() => {
	state.inserted = [];
	state.updates = [];
	state.deleted = 0;
	state.stale = [];
	state.failFinish = false;
});

const input = {
	kind: "database" as const,
	scope: { backupId: "b1" },
	organizationId: "org-1",
	destinationId: "d1",
	trigger: "schedule" as const,
};

describe("sanitizeRunError", () => {
	it("keeps only the program name of a failed command line", () => {
		expect(
			sanitizeRunError(
				new Error("Command failed: docker exec abc sh -c 'pg_dump -U u'\npg_dump: error: boom"),
			),
		).toBe("Command failed: docker\npg_dump: error: boom");
	});

	it("masks known secrets and caps the length", () => {
		expect(sanitizeRunError("key AKIAXYZ leaked", ["AKIAXYZ"])).toBe("key [redacted] leaked");
		expect(sanitizeRunError("x", ["ab"])).toBe("x");
		expect(sanitizeRunError("a".repeat(5000)).length).toBe(2001);
		expect(sanitizeRunError("")).toBe("Unknown error");
		expect(sanitizeRunError(null)).toBe("null");
	});
});

describe("withBackupRun", () => {
	it("records running → success with the key and size the work returns", async () => {
		const result = await withBackupRun(input, async () => ({ key: "backup/app/x.gz", bytes: 42 }));
		expect(result).toEqual({ key: "backup/app/x.gz", bytes: 42 });
		expect(state.inserted).toEqual([
			expect.objectContaining({
				kind: "database",
				backupId: "b1",
				volumeBackupId: null,
				organizationId: "org-1",
				destinationId: "d1",
				trigger: "schedule",
				status: "running",
			}),
		]);
		expect(state.updates).toEqual([
			expect.objectContaining({
				status: "success",
				bytes: 42,
				objectKey: "backup/app/x.gz",
				error: null,
				finishedAt: expect.any(Date),
			}),
		]);
	});

	it("records error with a sanitised message and rethrows", async () => {
		await expect(
			withBackupRun({ ...input, secrets: ["s3cret"] }, async (run) => {
				run.redact("dbpass");
				throw new Error("Command failed: docker run s3cret\nauth failed for dbpass");
			}),
		).rejects.toThrow(/auth failed for dbpass/);
		expect(state.updates).toEqual([
			expect.objectContaining({
				status: "error",
				error: "Command failed: docker\nauth failed for [redacted]",
			}),
		]);
	});

	it("prunes the scope after every run and keeps verify keys when work returns none", async () => {
		state.stale = [{ backupRunId: "old-1" }, { backupRunId: "old-2" }];
		await withBackupRun({ ...input, trigger: "verify", objectKey: "k" }, async () => ({
			bytes: 1,
		}));
		expect(state.updates[0]).toMatchObject({ status: "success", objectKey: "k" });
		expect(state.deleted).toBe(1);
	});

	it("never lets history bookkeeping mask the work's result", async () => {
		state.failFinish = true;
		await expect(withBackupRun(input, async () => ({ key: "k", bytes: 1 }))).resolves.toEqual({
			key: "k",
			bytes: 1,
		});
		await expect(
			withBackupRun(input, async () => {
				throw new Error("real failure");
			}),
		).rejects.toThrow("real failure");
	});
});

describe("pruneBackupRuns", () => {
	it("deletes nothing when the history fits", async () => {
		expect(await pruneBackupRuns({ volumeBackupId: "v1" })).toBe(0);
		expect(state.deleted).toBe(0);
	});

	it("deletes the rows past the retention window", async () => {
		state.stale = [{ backupRunId: "old" }];
		expect(await pruneBackupRuns({ backupId: "b1" }, 5)).toBe(1);
		expect(state.deleted).toBe(1);
	});
});
