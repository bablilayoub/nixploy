import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	appendPoint,
	COMPACTION_INTERVAL_MS,
	compactFile,
	RING_LIMIT,
	readLatestPoint,
	readPointsSince,
	resetMetricsStore,
	ringPoints,
	TAIL_CHUNK_BYTES,
} from "./store";

interface Point {
	t: number;
	cpu: number;
}

const HOUR = 60 * 60 * 1000;
const RETENTION = 48 * HOUR;

let dir: string;
let file: string;

beforeEach(async () => {
	resetMetricsStore();
	dir = await mkdtemp(join(tmpdir(), "nixploy-metrics-"));
	file = join(dir, "shop.jsonl");
});

const lines = async (): Promise<Point[]> =>
	(await readFile(file, "utf8"))
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Point);

describe("appendPoint", () => {
	it("appends one line per sample instead of rewriting the file", async () => {
		const now = Date.now();
		await appendPoint<Point>(file, { t: now, cpu: 1 }, { retentionMs: RETENTION, now });
		const afterFirst = (await stat(file)).size;
		await appendPoint<Point>(file, { t: now + 1, cpu: 2 }, { retentionMs: RETENTION, now });
		const afterSecond = (await stat(file)).size;

		expect(await lines()).toEqual([
			{ t: now, cpu: 1 },
			{ t: now + 1, cpu: 2 },
		]);
		// The file only ever grew by the new line.
		expect(afterSecond - afterFirst).toBe(afterFirst);
	});

	it("keeps a bounded in-memory ring of the newest points", async () => {
		const now = Date.now();
		for (let index = 0; index < RING_LIMIT + 10; index++) {
			await appendPoint<Point>(
				file,
				{ t: now + index, cpu: index },
				{ retentionMs: RETENTION, now },
			);
		}
		const ring = ringPoints<Point>(file);
		expect(ring).toHaveLength(RING_LIMIT);
		expect(ring[0]?.cpu).toBe(10);
		expect(ring.at(-1)?.cpu).toBe(RING_LIMIT + 9);
	});

	it("compacts at most once an hour, dropping points past the retention window", async () => {
		const now = Date.now();
		// A file left behind by an earlier process, half of it stale.
		await writeFile(
			file,
			`${[
				JSON.stringify({ t: now - 50 * HOUR, cpu: 1 }),
				JSON.stringify({ t: now - 49 * HOUR, cpu: 2 }),
				JSON.stringify({ t: now - 2 * HOUR, cpu: 3 }),
			].join("\n")}\n`,
			"utf8",
		);

		// First append after boot compacts.
		await appendPoint<Point>(file, { t: now, cpu: 4 }, { retentionMs: RETENTION, now });
		expect((await lines()).map((point) => point.cpu)).toEqual([3, 4]);

		// The next appends inside the hour do NOT rewrite anything.
		await appendPoint<Point>(
			file,
			{ t: now + 1, cpu: 5 },
			{ retentionMs: RETENTION, now: now + 60_000 },
		);
		expect((await lines()).map((point) => point.cpu)).toEqual([3, 4, 5]);

		// An hour later the window is trimmed again.
		const later = now + COMPACTION_INTERVAL_MS + 1;
		await appendPoint<Point>(file, { t: later, cpu: 6 }, { retentionMs: 60_000, now: later });
		expect((await lines()).map((point) => point.cpu)).toEqual([6]);
	});

	it("leaves no temp file behind and skips the rewrite when nothing is stale", async () => {
		const now = Date.now();
		await appendPoint<Point>(file, { t: now, cpu: 1 }, { retentionMs: RETENTION, now });
		expect(await compactFile(file, now - RETENTION)).toBe(0);
		await expect(stat(`${file}.tmp`)).rejects.toThrow();
	});
});

describe("readPointsSince", () => {
	it("returns only the requested window", async () => {
		const now = Date.now();
		for (const offset of [-5 * HOUR, -3 * HOUR, -1 * HOUR, 0]) {
			await appendPoint<Point>(
				file,
				{ t: now + offset, cpu: offset },
				{ retentionMs: RETENTION, now },
			);
		}
		const points = await readPointsSince<Point>(file, now - 2 * HOUR);
		expect(points.map((point) => point.cpu)).toEqual([-HOUR, 0]);
	});

	it("grows the tail chunk until the window is covered", async () => {
		const now = Date.now();
		// ~4 000 points of padded JSON: comfortably more than one 64 KiB chunk.
		const payload = "x".repeat(80);
		const rows: string[] = [];
		for (let index = 0; index < 4_000; index++) {
			rows.push(JSON.stringify({ t: now - (4_000 - index) * 1_000, cpu: index, pad: payload }));
		}
		await writeFile(file, `${rows.join("\n")}\n`, "utf8");
		expect((await stat(file)).size).toBeGreaterThan(TAIL_CHUNK_BYTES);

		const all = await readPointsSince<Point>(file, 0);
		expect(all).toHaveLength(4_000);
		expect(all[0]?.cpu).toBe(0);

		// A short window still only needs the first chunk.
		const recent = await readPointsSince<Point>(file, now - 60_000);
		expect(recent).toHaveLength(60);
	});

	it("never yields a torn line from the middle of a chunk", async () => {
		const now = Date.now();
		const rows = Array.from({ length: 2_000 }, (_, index) =>
			JSON.stringify({ t: now - (2_000 - index) * 1_000, cpu: index, pad: "y".repeat(120) }),
		);
		await writeFile(file, `${rows.join("\n")}\n`, "utf8");
		const points = await readPointsSince<Point>(file, now - 10 * 60 * 1000);
		expect(points.every((point) => typeof point.cpu === "number")).toBe(true);
		expect(points.at(-1)?.cpu).toBe(1_999);
	});

	it("returns nothing for a missing or empty file", async () => {
		expect(await readPointsSince<Point>(join(dir, "nope.jsonl"), 0)).toEqual([]);
		await writeFile(file, "", "utf8");
		expect(await readPointsSince<Point>(file, 0)).toEqual([]);
	});
});

describe("readLatestPoint", () => {
	it("answers from the ring once the sampler has written a point", async () => {
		const now = Date.now();
		await appendPoint<Point>(file, { t: now, cpu: 7 }, { retentionMs: RETENTION, now });
		expect(await readLatestPoint<Point>(file)).toEqual({ t: now, cpu: 7 });
	});

	it("warms the ring from the file tail on a cold process", async () => {
		const now = Date.now();
		await writeFile(
			file,
			`${[
				JSON.stringify({ t: now - 2_000, cpu: 1 }),
				JSON.stringify({ t: now - 1_000, cpu: 2 }),
			].join("\n")}\n`,
			"utf8",
		);
		expect(ringPoints(file)).toEqual([]);
		expect(await readLatestPoint<Point>(file)).toEqual({ t: now - 1_000, cpu: 2 });
		expect(ringPoints(file)).toHaveLength(2);
	});

	it("returns null when there is no history", async () => {
		expect(await readLatestPoint<Point>(join(dir, "nope.jsonl"))).toBeNull();
	});
});
