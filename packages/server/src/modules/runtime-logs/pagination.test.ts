import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMergedRuntimeLogs } from "./pagination";
import { parseLogQuery } from "./query";
import { appendRuntimeLogLines } from "./store";

describe("organization runtime log pagination", () => {
	let dir: string;
	let previous: string | undefined;
	const t = Date.parse("2026-10-20T12:00:00Z");
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "nixploy-log-pages-"));
		previous = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = dir;
	});
	afterEach(async () => {
		if (previous === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
		else process.env.NIXPLOY_CONFIG_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	it("returns all same-millisecond entries from multiple services exactly once", async () => {
		for (const appName of ["alpha", "bravo", "charlie"]) {
			await appendRuntimeLogLines(
				appName,
				Array.from({ length: 13 }, (_, index) => ({
					t,
					level: "info" as const,
					message: `${appName}:${index}`,
				})),
			);
		}
		const messages: string[] = [];
		let cursor: string | null = null;
		for (let attempts = 0; attempts < 20; attempts++) {
			const page = await readMergedRuntimeLogs({
				appNames: ["charlie", "alpha", "bravo"],
				limit: 5,
				cursor,
			});
			messages.push(...page.lines.map((line) => line.message));
			cursor = page.nextPageCursor;
			if (!cursor) break;
		}
		expect(cursor).toBeNull();
		expect(messages).toEqual(
			["alpha", "bravo", "charlie"].flatMap((name) =>
				Array.from({ length: 13 }, (_, index) => `${name}:${12 - index}`),
			),
		);
	});
	it("advances through zero-match scan-budget pages without hiding older matches", async () => {
		for (const appName of ["alpha", "bravo"]) {
			await appendRuntimeLogLines(
				appName,
				Array.from({ length: 12 }, (_, index) => ({
					t: t + index,
					level: "info" as const,
					message: index === 0 ? "needle" : "noise",
				})),
			);
		}
		const found: string[] = [];
		let cursor: string | null = null;
		let emptyContinuations = 0;
		for (let attempts = 0; attempts < 30; attempts++) {
			const page = await readMergedRuntimeLogs({
				appNames: ["alpha", "bravo"],
				limit: 5,
				cursor,
				maxScanned: 4,
				query: parseLogQuery("needle"),
			});
			found.push(...page.lines.map((line) => line.appName));
			if (page.lines.length === 0 && page.nextPageCursor) emptyContinuations++;
			cursor = page.nextPageCursor;
			if (!cursor) break;
		}
		expect(cursor).toBeNull();
		expect(emptyContinuations).toBeGreaterThan(0);
		expect(found).toEqual(["alpha", "bravo"]);
		expect(
			(await readMergedRuntimeLogs({ appNames: ["alpha", "bravo"], before: t, limit: 5 })).lines,
		).toEqual([]);
	});
});
