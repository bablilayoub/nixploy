import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../test-utils/tmpdir";

/**
 * A schedule's run log is whatever its command printed — dump paths,
 * connection strings, API responses. It must land 0600 like every other
 * artefact under the config directory (hardening handoff).
 */

// The module reads `NIXPLOY_SCHEDULES_LOG_PATH` once, at import time — so the
// directory has to exist before the dynamic import below.
const logsDir = path.join(await makeTempDir("nixploy-schedule-logs-"), "schedules");
process.env.NIXPLOY_SCHEDULES_LOG_PATH = logsDir;

afterAll(async () => {
	await rm(path.dirname(logsDir), { recursive: true, force: true }).catch(() => {});
});

const runScheduleCommand = vi.fn();
vi.mock("./runner", () => ({
	runScheduleCommand: (...args: unknown[]) => runScheduleCommand(...args),
}));

const inserted: Array<Record<string, unknown>> = [];
vi.mock("../../db", () => ({
	db: {
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				inserted.push(values);
				return Promise.resolve();
			},
		}),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
		query: { schedules: { findFirst: () => Promise.resolve(null) } },
	},
}));

const { runSchedule } = await import("./index");

const row = {
	scheduleId: "sched-1",
	name: "Nightly dump",
	cronExpression: "0 3 * * *",
	shellType: "bash" as const,
	command: "pg_dump",
	script: null,
	enabled: true,
	scheduleType: "application" as const,
	runMode: "exec" as const,
	image: null,
	appName: "api",
	applicationId: "app-1",
	composeId: null,
	serverId: null,
	userId: "user-1",
	lastRunAt: null,
	createdAt: new Date(),
};

/** The log of the run that was just recorded (the deployment row names it). */
const readOnlyLog = async (): Promise<{ file: string; mode: number; body: string }> => {
	const file = inserted.at(-1)?.logPath;
	if (typeof file !== "string") throw new Error("no run recorded");
	expect(path.dirname(file)).toBe(logsDir);
	const info = await stat(file);
	return { file, mode: info.mode & 0o777, body: await readFile(file, "utf8") };
};

beforeEach(() => {
	inserted.length = 0;
	runScheduleCommand.mockReset();
});

describe("schedule run logs", () => {
	it("writes a successful run's log 0600", async () => {
		runScheduleCommand.mockResolvedValue("DATABASE_URL=postgres://user:secret@db/app\n");
		const result = await runSchedule({ ...row, scheduleId: `ok-${Date.now()}` }, "manual");
		expect(result.success).toBe(true);

		const log = await readOnlyLog();
		expect(log.mode).toBe(0o600);
		expect(log.body).toContain("Status: done");
		expect(log.body).toContain("postgres://user:secret@db/app");
	});

	it("writes a failed run's log 0600 too", async () => {
		runScheduleCommand.mockRejectedValue(new Error("exit 1"));
		await expect(
			runSchedule({ ...row, scheduleId: `bad-${Date.now()}` }, "cron"),
		).resolves.toMatchObject({ success: false });

		const log = await readOnlyLog();
		expect(log.mode).toBe(0o600);
		expect(log.body).toContain("Status: error");
	});

	it("mirrors the run into a deployment row pointing at the log", async () => {
		runScheduleCommand.mockResolvedValue("done");
		await runSchedule({ ...row, scheduleId: `mirror-${Date.now()}` }, "cron");
		const log = await readOnlyLog();
		expect(inserted.at(-1)).toMatchObject({
			logPath: log.file,
			trigger: "schedule",
			applicationId: "app-1",
			status: "done",
		});
	});
});
