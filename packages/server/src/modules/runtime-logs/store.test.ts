import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLogQuery } from "./query";
import {
	appendRuntimeLogLines,
	hourKey,
	pruneRuntimeLogs,
	readHarvestState,
	readRuntimeLogs,
	runtimeLogUsage,
	sealClosedHours,
	writeHarvestState,
} from "./store";

const HOUR = 60 * 60 * 1000;

describe("runtime log store", () => {
	let dir: string;
	let previous: string | undefined;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "nixploy-runtime-logs-"));
		previous = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = dir;
	});
	afterEach(async () => {
		if (previous === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
		else process.env.NIXPLOY_CONFIG_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});

	const now = Date.parse("2026-09-19T21:30:00Z");

	it("appends across hour files, seals closed hours and reads newest-first with a cursor", async () => {
		await appendRuntimeLogLines("shop", [
			{ t: now - 2 * HOUR, level: "info", message: "two hours ago" },
			{ t: now - HOUR + 1000, level: "error", message: "an hour ago: failed" },
			{ t: now - 1000, level: "info", message: "just now" },
		]);
		expect((await readdir(path.join(dir, "runtime-logs", "shop"))).sort()).toEqual([
			`${hourKey(now - 2 * HOUR)}.jsonl`,
			`${hourKey(now - HOUR)}.jsonl`,
			`${hourKey(now)}.jsonl`,
		]);
		expect(await sealClosedHours("shop", now)).toBe(2);
		expect((await readdir(path.join(dir, "runtime-logs", "shop"))).sort()).toEqual([
			`${hourKey(now - 2 * HOUR)}.jsonl.gz`,
			`${hourKey(now - HOUR)}.jsonl.gz`,
			`${hourKey(now)}.jsonl`,
		]);

		const first = await readRuntimeLogs({ appName: "shop", limit: 2 });
		expect(first.lines.map((line) => line.message)).toEqual(["just now", "an hour ago: failed"]);
		expect(first.nextCursor).toBe(now - HOUR + 1000);
		const second = await readRuntimeLogs({ appName: "shop", limit: 2, before: first.nextCursor });
		expect(second.lines.map((line) => line.message)).toEqual(["two hours ago"]);
		expect(second.nextCursor).toBeNull();

		const errors = await readRuntimeLogs({
			appName: "shop",
			limit: 10,
			query: parseLogQuery("level:error failed"),
		});
		expect(errors.lines.map((line) => line.message)).toEqual(["an hour ago: failed"]);
	});

	it("stops on its scan budget and says so", async () => {
		await appendRuntimeLogLines(
			"chatty",
			Array.from({ length: 50 }, (_, index) => ({
				t: now - index * 1000,
				level: "info" as const,
				message: `line ${index}`,
			})),
		);
		const page = await readRuntimeLogs({
			appName: "chatty",
			limit: 100,
			query: parseLogQuery("nomatch"),
			maxScanned: 10,
		});
		expect(page.lines).toEqual([]);
		expect(page.truncated).toBe(true);
		expect(page.scanned).toBe(10);
		expect(page.nextCursor).not.toBeNull();
	});

	it("pages every equal-millisecond line across compression and concurrent appends", async () => {
		await appendRuntimeLogLines(
			"ties",
			Array.from({ length: 53 }, (_, index) => ({
				t: now,
				level: "info" as const,
				message: String(index),
			})),
		);
		const first = await readRuntimeLogs({ appName: "ties", limit: 10 });
		await appendRuntimeLogLines("ties", [{ t: now, level: "info", message: "new after page" }]);
		await sealClosedHours("ties", now + HOUR);
		const messages = first.lines.map((line) => line.message);
		let cursor = first.nextPageCursor;
		while (cursor) {
			const page = await readRuntimeLogs({ appName: "ties", limit: 10, cursor });
			messages.push(...page.lines.map((line) => line.message));
			cursor = page.nextPageCursor;
		}
		expect(messages).toEqual(Array.from({ length: 53 }, (_, index) => String(52 - index)));
	});

	it("orders out-of-order container appends and preserves legacy before and time windows", async () => {
		await appendRuntimeLogLines("mixed", [
			{ t: now, level: "info", message: "latest" },
			{ t: now - 2, level: "info", message: "oldest" },
			{ t: now - 1, level: "info", message: "middle" },
		]);
		expect(
			(await readRuntimeLogs({ appName: "mixed", limit: 10 })).lines.map((line) => line.message),
		).toEqual(["latest", "middle", "oldest"]);
		expect(
			(await readRuntimeLogs({ appName: "mixed", limit: 10, before: now })).lines.map(
				(line) => line.message,
			),
		).toEqual(["middle", "oldest"]);
		expect(
			(
				await readRuntimeLogs({ appName: "mixed", limit: 10, since: now - 1, until: now - 1 })
			).lines.map((line) => line.message),
		).toEqual(["middle"]);
		await expect(
			readRuntimeLogs({ appName: "mixed", limit: 10, cursor: "invalid" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("prunes by age and by bytes and drops a dead service's directory", async () => {
		const old = now - 10 * 24 * HOUR;
		await appendRuntimeLogLines("stale", [{ t: old, level: "info", message: "old" }]);
		await appendRuntimeLogLines("big", [
			{ t: now - 3 * HOUR, level: "info", message: "x".repeat(2000) },
			{ t: now - 2 * HOUR, level: "info", message: "y".repeat(2000) },
			{ t: now, level: "info", message: "current" },
		]);
		await writeHarvestState("big", { cursors: { abcdefabcdef: { ts: "t", seenAt: now } } });
		expect(await runtimeLogUsage("big")).toBeGreaterThan(4000);

		const result = await pruneRuntimeLogs({ retentionDays: 7, maxBytesPerService: 2500, now });
		expect(result).toEqual({ removedFiles: 2, removedServices: 1 });
		expect(await readdir(path.join(dir, "runtime-logs"))).toEqual(["big"]);
		const remaining = (await readdir(path.join(dir, "runtime-logs", "big"))).sort();
		expect(remaining).toEqual([
			`${hourKey(now - 2 * HOUR)}.jsonl`,
			`${hourKey(now)}.jsonl`,
			"state.json",
		]);
		expect((await readHarvestState("big")).cursors.abcdefabcdef?.seenAt).toBe(now);
	});

	it("applies per-service limits when a resolver is given", async () => {
		const lines = [
			{ t: now - 3 * 24 * HOUR, level: "info" as const, message: "three days ago" },
			{ t: now, level: "info" as const, message: "now" },
		];
		await appendRuntimeLogLines("short", lines);
		await appendRuntimeLogLines("long", lines);
		const result = await pruneRuntimeLogs({
			retentionDays: 7,
			maxBytesPerService: 0,
			now,
			limitsFor: async (appName) => ({
				retentionDays: appName === "short" ? 1 : 7,
				maxBytes: 0,
			}),
		});
		expect(result.removedFiles).toBe(1);
		expect(await readdir(path.join(dir, "runtime-logs", "short"))).toEqual([
			`${hourKey(now)}.jsonl`,
		]);
		expect((await readdir(path.join(dir, "runtime-logs", "long"))).length).toBe(2);
	});
});
