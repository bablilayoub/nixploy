import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
	state: {
		/** Results handed back by successive `db.execute` calls. */
		executeResults: [] as unknown[][],
		executed: [] as unknown[],
		deleted: [] as Array<{ table: unknown; where: unknown }>,
		deleteResult: [] as unknown[],
	},
}));

vi.mock("../../db", () => ({
	db: {
		execute: vi.fn(async (query: unknown) => {
			state.executed.push(query);
			return state.executeResults.shift() ?? [];
		}),
		delete: (table: unknown) => ({
			where: (where: unknown) => ({
				returning: async () => {
					state.deleted.push({ table, where });
					return state.deleteResult;
				},
			}),
		}),
	},
}));
vi.mock("../preview", () => ({ deletePreviewDeployment: vi.fn() }));
vi.mock("node-schedule", () => ({ default: { scheduleJob: vi.fn() } }));

import {
	DEFAULT_AUDIT_RETENTION_DAYS,
	DEPLOYMENTS_KEPT_PER_TARGET,
	findOrphanDeploymentIds,
	pruneAuditLogs,
	pruneDeploymentLogs,
	pruneDeploymentRows,
	pruneIncidents,
	pruneScheduleLogs,
	removeDeploymentArtifacts,
	resolveAuditRetentionDays,
} from "./maintenance";

const dialect = new PgDialect();
const render = (query: unknown) =>
	dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
const tableName = (table: unknown): string =>
	String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");

const DAY = 24 * 60 * 60 * 1000;
const touch = async (file: string, ageMs: number, content = "log") => {
	await writeFile(file, content);
	const when = new Date(Date.now() - ageMs);
	await utimes(file, when, when);
};

let configDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
	configDir = await mkdtemp(join(tmpdir(), "nixploy-maintenance-"));
	for (const key of ["NIXPLOY_CONFIG_DIR", "NIXPLOY_SCHEDULES_LOG_PATH"]) {
		savedEnv[key] = process.env[key];
	}
	process.env.NIXPLOY_CONFIG_DIR = configDir;
	delete process.env.NIXPLOY_SCHEDULES_LOG_PATH;
	state.executeResults = [];
	state.executed = [];
	state.deleted = [];
	state.deleteResult = [];
});

afterEach(async () => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(configDir, { recursive: true, force: true });
});

describe("resolveAuditRetentionDays", () => {
	it("defaults, honours 0 = forever, rejects garbage", () => {
		expect(resolveAuditRetentionDays(undefined)).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
		expect(resolveAuditRetentionDays("")).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
		expect(resolveAuditRetentionDays("0")).toBe(0);
		expect(resolveAuditRetentionDays("30")).toBe(30);
		expect(resolveAuditRetentionDays(" 30 ")).toBe(30);
		expect(resolveAuditRetentionDays("abc")).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
		expect(resolveAuditRetentionDays("-5")).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
		expect(resolveAuditRetentionDays("1.5")).toBe(DEFAULT_AUDIT_RETENTION_DAYS);
	});
});

describe("removeDeploymentArtifacts", () => {
	it("removes the log and its explain sidecar, tolerating missing files", async () => {
		await writeFile(join(configDir, "a.log"), "a");
		await writeFile(join(configDir, "a.explain.json"), "{}");
		await writeFile(join(configDir, "b.log"), "b");
		const removed = await removeDeploymentArtifacts([
			join(configDir, "a.log"),
			join(configDir, "b.log"),
			join(configDir, "missing.log"),
			"relative.log",
			join(configDir, "not-a-log.txt"),
		]);
		expect(removed).toBe(3);
		expect(await readdir(configDir)).toEqual([]);
	});
});

describe("pruneDeploymentRows", () => {
	it("deletes beyond the per-target cap and retention, then removes the files", async () => {
		await writeFile(join(configDir, "old.log"), "x");
		await writeFile(join(configDir, "old.explain.json"), "{}");
		state.executeResults = [[{ log_path: join(configDir, "old.log") }, { log_path: null }]];

		const now = new Date("2026-09-10T00:00:00Z");
		const result = await pruneDeploymentRows({ now });
		expect(result).toEqual({ rows: 2, files: 2 });
		expect(await readdir(configDir)).toEqual([]);

		const { sql: rawSql, params } = render(state.executed[0]);
		const sql = rawSql.toLowerCase();
		expect(sql).toContain("row_number() over");
		expect(sql).toContain("partition by coalesce(schedule_id, application_id, compose_id, '')");
		expect(sql).toContain("d.status not in ('running', 'queued')");
		expect(sql).toContain("not exists (select 1 from rollback");
		expect(sql).toContain("returning d.log_path");
		expect(params[0]).toBe(DEPLOYMENTS_KEPT_PER_TARGET);
		expect(params[1]).toEqual(new Date(now.getTime() - 30 * DAY));
	});

	it("honours custom cap and retention", async () => {
		await pruneDeploymentRows({ keepPerTarget: 5, retentionMs: DAY, now: new Date(1_000_000) });
		const { params } = render(state.executed[0]);
		expect(params[0]).toBe(5);
		expect(params[1]).toEqual(new Date(1_000_000 - DAY));
	});
});

describe("findOrphanDeploymentIds", () => {
	it("anti-joins the id list in chunks and unions the orphans", async () => {
		const ids = Array.from({ length: 1_200 }, (_, i) => `dep-${i}`);
		state.executeResults = [[{ id: "dep-1" }], [], [{ id: "dep-1100" }]];
		const orphans = await findOrphanDeploymentIds(ids);
		expect([...orphans]).toEqual(["dep-1", "dep-1100"]);
		expect(state.executed).toHaveLength(3);
		const { sql, params } = render(state.executed[0]);
		expect(sql.toLowerCase()).toContain("from unnest($1::text[])");
		expect(sql.toLowerCase()).toContain("not exists (select 1 from deployment");
		expect(params).toEqual([ids.slice(0, 500)]);
		expect(render(state.executed[2]).params).toEqual([ids.slice(1_000)]);
	});

	it("skips the query for an empty list", async () => {
		expect(await findOrphanDeploymentIds([])).toEqual(new Set());
		expect(state.executed).toHaveLength(0);
	});
});

describe("pruneDeploymentLogs", () => {
	it("removes expired logs, orphans of recent logs, and empty service dirs", async () => {
		const svc = join(configDir, "logs", "svc");
		await mkdir(svc, { recursive: true });
		await touch(join(svc, "old.log"), 31 * DAY);
		await touch(join(svc, "live.log"), DAY);
		await touch(join(svc, "orphan.log"), DAY);
		await touch(join(svc, "orphan.explain.json"), DAY, "{}");
		await touch(join(svc, "notes.txt"), 40 * DAY);
		const empty = join(configDir, "logs", "gone");
		await mkdir(empty, { recursive: true });
		await touch(join(empty, "ancient.log"), 90 * DAY);
		// One anti-join per directory with recent logs; `gone` has none left.
		state.executeResults = [[{ id: "orphan" }]];

		const removed = await pruneDeploymentLogs();
		expect(removed).toBe(4); // old.log, orphan.log + sidecar, ancient.log
		expect((await readdir(svc)).sort()).toEqual(["live.log", "notes.txt"]);
		await expect(readdir(empty)).rejects.toThrow();

		expect(state.executed).toHaveLength(1);
		const { params } = render(state.executed[0]);
		expect((params[0] as string[]).sort()).toEqual(["live", "orphan"]);
	});

	it("keeps recent logs when the reconciliation query fails", async () => {
		const svc = join(configDir, "logs", "svc");
		await mkdir(svc, { recursive: true });
		await touch(join(svc, "recent.log"), DAY);
		state.executeResults = [];
		const { db } = await import("../../db");
		vi.mocked(db.execute).mockRejectedValueOnce(new Error("db down"));
		expect(await pruneDeploymentLogs()).toBe(0);
		expect(await readdir(svc)).toEqual(["recent.log"]);
	});

	it("is a no-op before the first deployment", async () => {
		expect(await pruneDeploymentLogs()).toBe(0);
	});
});

describe("pruneScheduleLogs", () => {
	it("removes old run logs from the schedules directory", async () => {
		const dir = join(configDir, "schedules");
		await mkdir(dir, { recursive: true });
		await touch(join(dir, "sch-1-100.log"), 31 * DAY);
		await touch(join(dir, "sch-1-200.log"), DAY);
		await touch(join(dir, "keep.json"), 60 * DAY, "{}");
		expect(await pruneScheduleLogs()).toBe(1);
		expect((await readdir(dir)).sort()).toEqual(["keep.json", "sch-1-200.log"]);
	});

	it("follows NIXPLOY_SCHEDULES_LOG_PATH", async () => {
		const custom = await mkdtemp(join(tmpdir(), "nixploy-sched-"));
		try {
			process.env.NIXPLOY_SCHEDULES_LOG_PATH = custom;
			await touch(join(custom, "x.log"), 40 * DAY);
			expect(await pruneScheduleLogs()).toBe(1);
			expect(await readdir(custom)).toEqual([]);
		} finally {
			await rm(custom, { recursive: true, force: true });
		}
	});

	it("is a no-op when nothing ran yet", async () => {
		expect(await pruneScheduleLogs()).toBe(0);
	});
});

describe("pruneIncidents", () => {
	it("drops resolved-and-stale or simply ancient incidents", async () => {
		state.deleteResult = [{}, {}, {}];
		const now = new Date("2026-09-10T00:00:00Z");
		expect(await pruneIncidents(now)).toBe(3);
		expect(state.deleted).toHaveLength(1);
		expect(tableName(state.deleted[0]?.table)).toBe("incident");
		const { sql, params } = render(state.deleted[0]?.where);
		expect(sql).toContain('"resolved_at" is not null');
		expect(sql).toContain('"resolved_at" <');
		expect(sql).toContain('"created_at" <');
		// Column-typed comparisons go through drizzle's timestamp mapper (ISO strings).
		expect(params).toEqual([
			new Date(now.getTime() - 90 * DAY).toISOString(),
			new Date(now.getTime() - 180 * DAY).toISOString(),
		]);
	});
});

describe("pruneAuditLogs", () => {
	it("keeps everything when retention is 0", async () => {
		expect(await pruneAuditLogs(0)).toBe(0);
		expect(state.deleted).toHaveLength(0);
	});

	it("deletes rows older than the retention window", async () => {
		state.deleteResult = [{}];
		const now = new Date("2026-09-10T00:00:00Z");
		expect(await pruneAuditLogs(30, now)).toBe(1);
		expect(tableName(state.deleted[0]?.table)).toBe("audit_log");
		const { params } = render(state.deleted[0]?.where);
		expect(params).toEqual([new Date(now.getTime() - 30 * DAY).toISOString()]);
	});
});
