import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the pure helpers are exercised; keep the module import offline.
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../utils/exec", () => ({ execAsync: vi.fn() }));
vi.mock("../observability/health", () => ({ countActiveDeployments: vi.fn(async () => 0) }));
vi.mock("./settings", () => ({
	getUpdateSettings: vi.fn(),
	patchUpdateSettings: vi.fn(),
}));

import { imageTag, PRE_UPDATE_BACKUP_KEEP, prunePreUpdateDumps } from "./apply";

describe("imageTag", () => {
	it("extracts the tag and ignores digests and registry ports", () => {
		expect(imageTag("ghcr.io/bablilayoub/nixploy:v0.2.0@sha256:abc")).toBe("v0.2.0");
		expect(imageTag("ghcr.io/bablilayoub/nixploy:latest")).toBe("latest");
		expect(imageTag("localhost:5000/nixploy")).toBe("");
		expect(imageTag("nixploy@sha256:abc")).toBe("");
	});
});

describe("prunePreUpdateDumps", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nixploy-dumps-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("keeps the newest dumps and leaves other files alone", async () => {
		const names = ["a", "b", "c", "d", "e"].map((n) => `pre-update-v0.1.${n}-t.sql.gz`);
		for (const [index, name] of names.entries()) {
			const file = join(dir, name);
			await writeFile(file, "x");
			const when = new Date(2026, 0, 1 + index);
			await utimes(file, when, when);
		}
		await writeFile(join(dir, "manual.sql.gz"), "keep me");
		await writeFile(join(dir, "pre-update-notes.txt"), "keep me");

		const removed = await prunePreUpdateDumps(dir);
		expect(removed.map((f) => f.split("/").pop())).toEqual([names[1], names[0]]);
		const left = (await readdir(dir)).sort();
		expect(left).toEqual(
			[...names.slice(5 - PRE_UPDATE_BACKUP_KEEP), "manual.sql.gz", "pre-update-notes.txt"].sort(),
		);
	});

	it("is a no-op for a missing directory", async () => {
		await expect(prunePreUpdateDumps(join(dir, "missing"))).resolves.toEqual([]);
	});
});
