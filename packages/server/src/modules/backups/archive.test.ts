import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("../traefik/paths", () => ({ getConfigDir: () => state.dir }));

import { withValidatedArchive } from "./archive";
import { LocalBackupStore } from "./storage";

beforeEach(async () => {
	state.dir = await mkdtemp(path.join(tmpdir(), "nixploy-archive-"));
});
afterEach(async () => {
	await rm(state.dir, { recursive: true, force: true });
});

describe("validated restore archive", () => {
	it("pins one object version with private permissions and removes the spool", async () => {
		const store = new LocalBackupStore(path.join(state.dir, "objects"));
		const original = gzipSync("original marker");
		await store.put("a.gz", original);
		await withValidatedArchive(store, "a.gz", async (archive) => {
			expect(archive.bytes).toBe(original.length);
			await store.put("a.gz", gzipSync("replacement"));
			const stream = archive.open();
			expect((await stat(stream.path)).mode & 0o777).toBe(0o600);
			const chunks: Buffer[] = [];
			for await (const chunk of stream) chunks.push(Buffer.from(chunk));
			expect(Buffer.concat(chunks)).toEqual(original);
		});
		expect(await readdir(path.join(state.dir, "cache", "backup-restores"))).toEqual([]);
	});

	it.each(["crc", "truncated", "empty", "plain"])(
		"refuses %s before invoking the target",
		async (kind) => {
			const store = new LocalBackupStore(path.join(state.dir, "objects"));
			const gzip = gzipSync("valuable data");
			if (kind === "crc") gzip[gzip.length - 8] = (gzip[gzip.length - 8] ?? 0) ^ 0xff;
			const bytes =
				kind === "truncated"
					? gzip.subarray(0, -3)
					: kind === "empty"
						? gzipSync("")
						: kind === "plain"
							? Buffer.from("not gzip")
							: gzip;
			await store.put("bad.gz", bytes);
			const target = vi.fn();
			await expect(withValidatedArchive(store, "bad.gz", target)).rejects.toThrow();
			expect(target).not.toHaveBeenCalled();
			expect(await readdir(path.join(state.dir, "cache", "backup-restores"))).toEqual([]);
		},
	);

	it("propagates a source read error and cleans all partial spool bytes", async () => {
		const store = new LocalBackupStore(path.join(state.dir, "objects"));
		vi.spyOn(store, "getStream").mockResolvedValue(
			Readable.from(
				(async function* () {
					yield gzipSync("partial");
					throw new Error("download lost");
				})(),
			),
		);
		const target = vi.fn();
		await expect(withValidatedArchive(store, "bad.gz", target)).rejects.toThrow("download lost");
		expect(target).not.toHaveBeenCalled();
		expect(await readdir(path.join(state.dir, "cache", "backup-restores"))).toEqual([]);
	});

	it("cleans validated bytes when the target itself fails", async () => {
		const store = new LocalBackupStore(path.join(state.dir, "objects"));
		await store.put("a.gz", gzipSync("data"));
		await expect(
			withValidatedArchive(store, "a.gz", async () => {
				throw new Error("target failed");
			}),
		).rejects.toThrow("target failed");
		expect(await readdir(path.join(state.dir, "cache", "backup-restores"))).toEqual([]);
	});
});
