import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Overdue detection for backups (audit #17). Since migration 0023 the
 * reference is `backup.last_run_at` / `volume_backup.last_run_at`, stamped at
 * the START of a run so the opt-in boot replay cannot run the same window
 * twice. Rows written before 0023 have no marker and fall back to the derived
 * `backup_run` lookup, then to their creation time.
 */

const { rows } = vi.hoisted(() => ({
	rows: {
		backups: [] as Array<Record<string, unknown>>,
		volumeBackups: [] as Array<Record<string, unknown>>,
		runs: [] as Array<{ id: string | null; lastRunAt: Date | null }>,
		/** Bumped whenever the derived (pre-0023) `backup_run` lookup ran. */
		derivedLookups: 0,
	},
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			backups: { findMany: async () => rows.backups },
			volumeBackups: { findMany: async () => rows.volumeBackups },
		},
		select: () => ({
			from: () => ({
				where: () => {
					rows.derivedLookups += 1;
					return { groupBy: async () => rows.runs };
				},
			}),
		}),
	},
}));

// The runner drags the whole exec/docker/S3 graph in; overdue detection does
// not touch it.
vi.mock("./runner", () => ({
	backupServiceExists: async () => true,
	emitBackupNotification: async () => {},
	runBackup: async () => {},
	runVolumeBackup: async () => {},
}));

import { findOverdueBackups } from "./scheduler";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = new Date("2026-09-11T12:00:00.000Z");

const backup = (backupId: string, lastRunAt: Date | null) => ({
	backupId,
	appName: `db ${backupId}`,
	schedule: "0 * * * *",
	enabled: true,
	lastRunAt,
	createdAt: new Date(now.getTime() - 10 * DAY),
});

const volume = (volumeBackupId: string, lastRunAt: Date | null) => ({
	volumeBackupId,
	volumeName: `vol ${volumeBackupId}`,
	cronExpression: "0 * * * *",
	enabled: true,
	lastRunAt,
	createdAt: new Date(now.getTime() - 10 * DAY),
});

beforeEach(() => {
	rows.backups = [];
	rows.volumeBackups = [];
	rows.runs = [];
	rows.derivedLookups = 0;
});

describe("findOverdueBackups", () => {
	it("labels each entry with the table it came from", async () => {
		rows.backups = [backup("b1", new Date(now.getTime() - 5 * HOUR))];
		rows.volumeBackups = [volume("v1", new Date(now.getTime() - 3 * HOUR))];

		const overdue = await findOverdueBackups(now);
		expect(overdue).toEqual([
			expect.objectContaining({ id: "b1", kind: "database", missedIntervals: 5 }),
			expect.objectContaining({ id: "v1", kind: "volume", missedIntervals: 3 }),
		]);
	});

	it("prefers the row's own marker and skips the legacy lookup entirely", async () => {
		rows.backups = [
			backup("b1", new Date(now.getTime() - 5 * HOUR)),
			backup("b2", new Date(now.getTime() - MINUTE)),
		];
		// A stale derived value must NOT win over the stamped column.
		rows.runs = [{ id: "b1", lastRunAt: new Date(now.getTime() - 9 * DAY) }];

		const overdue = await findOverdueBackups(now);
		expect(overdue.map((entry) => entry.id)).toEqual(["b1"]);
		expect(overdue[0]?.missedIntervals).toBe(5);
		expect(rows.derivedLookups).toBe(0);
	});

	it("falls back to the backup_run trace for rows with no marker", async () => {
		rows.backups = [backup("b3", null)];
		rows.runs = [{ id: "b3", lastRunAt: new Date(now.getTime() - 4 * HOUR) }];

		const overdue = await findOverdueBackups(now);
		expect(overdue).toEqual([
			expect.objectContaining({ id: "b3", kind: "database", missedIntervals: 4 }),
		]);
		expect(rows.derivedLookups).toBe(1);
	});

	it("gives a backup that just ran a full interval of slack", async () => {
		rows.backups = [backup("b4", new Date(now.getTime() - 90 * MINUTE))];
		expect(await findOverdueBackups(now)).toEqual([]);
	});
});
