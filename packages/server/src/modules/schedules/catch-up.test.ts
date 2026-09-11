import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * node-schedule has no catch-up (audit #17): ticks missed while the panel was
 * down never run. Neither `schedule` nor `backup` carries a `last_run_at`
 * column, so "when did this last run" is derived from the rows each run
 * writes (`deployment` / `backup_run`) and reported at boot.
 */

const { rows } = vi.hoisted(() => ({
	rows: {
		schedules: [] as Array<Record<string, unknown>>,
		lastRuns: [] as Array<{ scheduleId: string | null; lastRunAt: Date | null }>,
	},
}));

vi.mock("../../db", () => ({
	db: {
		query: { schedules: { findMany: async () => rows.schedules } },
		select: () => ({
			from: () => ({
				where: () => ({ groupBy: async () => rows.lastRuns }),
			}),
		}),
	},
}));

// The runner drags the whole exec/docker graph in; the catch-up check does
// not touch it.
vi.mock("./runner", () => ({ runScheduleCommand: async () => ({}) }));

import { cronIntervalMs, findOverdueSchedules } from "./index";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => {
	rows.schedules = [];
	rows.lastRuns = [];
});

describe("cronIntervalMs", () => {
	it("measures the gap between two consecutive fires", () => {
		expect(cronIntervalMs("*/5 * * * *")).toBe(5 * MINUTE);
		expect(cronIntervalMs("0 * * * *")).toBe(HOUR);
		expect(cronIntervalMs("0 3 * * *")).toBe(DAY);
		expect(cronIntervalMs("0 0 * * 0")).toBe(7 * DAY);
	});

	it("returns null for something that is not a recurring cron", () => {
		expect(cronIntervalMs("not a cron")).toBeNull();
	});
});

describe("findOverdueSchedules", () => {
	const now = new Date("2026-09-11T12:00:00.000Z");

	const schedule = (scheduleId: string, cronExpression: string, createdAt: Date) => ({
		scheduleId,
		name: `job ${scheduleId}`,
		cronExpression,
		enabled: true,
		createdAt,
	});

	it("reports a schedule whose last run is several intervals old", async () => {
		rows.schedules = [
			schedule("s1", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
			schedule("s2", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
		];
		rows.lastRuns = [
			// s1 last ran 5 hours ago (5 missed hourly ticks); s2 ran a minute ago.
			{ scheduleId: "s1", lastRunAt: new Date(now.getTime() - 5 * HOUR) },
			{ scheduleId: "s2", lastRunAt: new Date(now.getTime() - MINUTE) },
		];

		const overdue = await findOverdueSchedules(now);
		expect(overdue.map((entry) => entry.scheduleId)).toEqual(["s1"]);
		expect(overdue[0]).toMatchObject({ missedIntervals: 5, cronExpression: "0 * * * *" });
	});

	it("falls back to the row's creation time when it never ran", async () => {
		rows.schedules = [schedule("s3", "0 * * * *", new Date(now.getTime() - 3 * DAY))];
		rows.lastRuns = [];

		const overdue = await findOverdueSchedules(now);
		expect(overdue).toHaveLength(1);
		expect(overdue[0]?.lastRunAt).toBeNull();
		expect(overdue[0]?.missedIntervals).toBe(72);
	});

	it("gives a freshly created schedule one full interval of slack", async () => {
		rows.schedules = [schedule("s4", "0 3 * * *", new Date(now.getTime() - HOUR))];
		expect(await findOverdueSchedules(now)).toEqual([]);
	});
});
