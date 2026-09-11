import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * node-schedule has no catch-up (audit #17): ticks missed while the panel was
 * down never run. Since migration 0023 `schedule.last_run_at` records when one
 * did — written at the START of a run, which is what makes the opt-in boot
 * replay (`NIXPLOY_CRON_CATCH_UP=1`) safe against a double run. Rows older than
 * 0023 have no marker and fall back to the `deployment` row each run writes.
 */

const { rows } = vi.hoisted(() => ({
	rows: {
		schedules: [] as Array<Record<string, unknown>>,
		lastRuns: [] as Array<{ scheduleId: string | null; lastRunAt: Date | null }>,
		/** Bumped whenever the derived (pre-0023) `deployment` lookup ran. */
		derivedLookups: 0,
	},
}));

vi.mock("../../db", () => ({
	db: {
		query: { schedules: { findMany: async () => rows.schedules } },
		select: () => ({
			from: () => ({
				where: () => {
					rows.derivedLookups += 1;
					return { groupBy: async () => rows.lastRuns };
				},
			}),
		}),
	},
}));

// The runner drags the whole exec/docker graph in; the catch-up check does
// not touch it.
vi.mock("./runner", () => ({ runScheduleCommand: async () => ({}) }));

import { cronCatchUpEnabled, cronIntervalMs, findOverdueSchedules } from "./index";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => {
	rows.schedules = [];
	rows.lastRuns = [];
	rows.derivedLookups = 0;
	delete process.env.NIXPLOY_CRON_CATCH_UP;
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

	it("prefers the row's own last_run_at and skips the legacy lookup entirely", async () => {
		rows.schedules = [
			{
				...schedule("s5", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
				lastRunAt: new Date(now.getTime() - 5 * HOUR),
			},
			{
				...schedule("s6", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
				lastRunAt: new Date(now.getTime() - MINUTE),
			},
		];
		// A stale derived value must NOT win over the stamped column.
		rows.lastRuns = [{ scheduleId: "s5", lastRunAt: new Date(now.getTime() - 9 * DAY) }];

		const overdue = await findOverdueSchedules(now);
		expect(overdue.map((entry) => entry.scheduleId)).toEqual(["s5"]);
		expect(overdue[0]?.missedIntervals).toBe(5);
		// Every row carries a marker: the `deployment` fallback query never ran.
		expect(rows.derivedLookups).toBe(0);
	});

	it("still queries the legacy trace for rows with no marker", async () => {
		rows.schedules = [
			{
				...schedule("s7", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
				lastRunAt: new Date(now.getTime() - MINUTE),
			},
			schedule("s8", "0 * * * *", new Date(now.getTime() - 10 * DAY)),
		];
		rows.lastRuns = [{ scheduleId: "s8", lastRunAt: new Date(now.getTime() - 4 * HOUR) }];

		const overdue = await findOverdueSchedules(now);
		expect(overdue.map((entry) => entry.scheduleId)).toEqual(["s8"]);
		expect(rows.derivedLookups).toBe(1);
	});
});

describe("cronCatchUpEnabled", () => {
	it("is off unless NIXPLOY_CRON_CATCH_UP is exactly 1", () => {
		expect(cronCatchUpEnabled()).toBe(false);
		process.env.NIXPLOY_CRON_CATCH_UP = "true";
		expect(cronCatchUpEnabled()).toBe(false);
		process.env.NIXPLOY_CRON_CATCH_UP = "1";
		expect(cronCatchUpEnabled()).toBe(true);
	});
});
