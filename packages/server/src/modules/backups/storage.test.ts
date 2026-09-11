import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../traefik/paths", () => ({ getConfigDir: () => "/tmp/nixploy-test-config" }));

import {
	isLocalDestination,
	isSafeLocalKey,
	LocalBackupStore,
	localDestinationRoot,
	resolveLocalKeyPath,
	storeFor,
} from "./storage";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "nixploy-local-store-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("local key safety", () => {
	it("accepts runner-shaped keys", () => {
		expect(isSafeLocalKey("backup/app/2026-09-11T00-00-00-000Z.gz")).toBe(true);
		expect(isSafeLocalKey("volume-backup/vol_1/x.gz")).toBe(true);
	});

	it("rejects traversal, absolute paths and odd segments", () => {
		for (const key of [
			"",
			"/etc/passwd",
			"../x",
			"backup/../../x",
			"backup/./x",
			"backup//x",
			"backup/x/",
			"backup\\x",
			"backup/x\0y",
		]) {
			expect(isSafeLocalKey(key), key).toBe(false);
			expect(() => resolveLocalKeyPath("/root", key)).toThrow(/Invalid backup key/);
		}
	});

	it("resolves inside the root", () => {
		expect(resolveLocalKeyPath("/data/backups/org", "backup/app/a.gz")).toBe(
			"/data/backups/org/backup/app/a.gz",
		);
	});
});

describe("LocalBackupStore", () => {
	it("put/get/list/remove round-trip with oldest-first listing", async () => {
		const store = new LocalBackupStore(root);
		await store.put("backup/app/b.gz", Buffer.from("second"));
		await store.put("backup/app/a.gz", Buffer.from("first"));
		await store.put("backup/other/c.gz", Buffer.from("other"));
		// mtime decides the order (like S3's LastModified), not the name.
		const older = new Date(Date.now() - 60_000);
		await utimes(path.join(root, "backup/app/a.gz"), older, older);

		expect(await store.list("backup/app/")).toEqual(["backup/app/a.gz", "backup/app/b.gz"]);
		expect((await store.get("backup/app/a.gz")).toString()).toBe("first");

		await store.remove(["backup/app/a.gz", "backup/app/missing.gz"]);
		expect(await store.list("backup/app/")).toEqual(["backup/app/b.gz"]);
		expect(await store.list("backup/")).toEqual(
			expect.arrayContaining(["backup/app/b.gz", "backup/other/c.gz"]),
		);
	});

	it("ignores partial writes and lists nothing for a missing root", async () => {
		const store = new LocalBackupStore(path.join(root, "nope"));
		expect(await store.list("backup/")).toEqual([]);
		await store.put("backup/app/a.gz", Buffer.from("ok"));
		await writeFile(path.join(root, "nope/backup/app/b.gz.part"), "half");
		expect(await store.list("backup/app/")).toEqual(["backup/app/a.gz"]);
		expect((await readFile(path.join(root, "nope/backup/app/a.gz"))).toString()).toBe("ok");
	});

	it("refuses unsafe keys on every operation", async () => {
		const store = new LocalBackupStore(root);
		await expect(store.put("../x.gz", Buffer.from("x"))).rejects.toThrow(/Invalid backup key/);
		await expect(store.get("/etc/passwd")).rejects.toThrow(/Invalid backup key/);
		await expect(store.remove(["a/../../x"])).rejects.toThrow(/Invalid backup key/);
	});

	it("test() creates the root and writes a probe", async () => {
		const store = new LocalBackupStore(path.join(root, "fresh"));
		await expect(store.test()).resolves.toBeUndefined();
		expect(await store.list("")).toEqual([]);
	});
});

describe("storeFor", () => {
	const base = {
		destinationId: "d1",
		name: "disk",
		accessKey: "local",
		secretAccessKey: "local",
		bucket: "local",
		region: "local",
		endpoint: "local",
		organizationId: "org-1",
		createdAt: new Date(),
	};

	it("routes provider=local to the per-org directory under <config>/backups", () => {
		const destination = { ...base, provider: "local" };
		expect(isLocalDestination(destination)).toBe(true);
		expect(localDestinationRoot(destination)).toBe("/tmp/nixploy-test-config/backups/org-1");
		const store = storeFor(destination);
		expect(store).toBeInstanceOf(LocalBackupStore);
		expect(store.describe("backup/app/a.gz")).toBe(
			"/tmp/nixploy-test-config/backups/org-1/backup/app/a.gz",
		);
	});

	it("everything else is S3", () => {
		const store = storeFor({ ...base, provider: "s3", bucket: "b" });
		expect(store).not.toBeInstanceOf(LocalBackupStore);
		expect(store.describe("k")).toBe("s3://b/k");
	});
});

describe("LocalBackupStore streaming", () => {
	it("writes a streamed archive 0600 and leaves nothing behind on failure", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nixploy-stream-"));
		try {
			const store = new LocalBackupStore(root);
			async function* source(): AsyncGenerator<Buffer> {
				yield Buffer.from("hello ");
				yield Buffer.from("world");
			}
			const bytes = await store.putStream("app/ok.gz", source());
			expect(bytes).toBe(11);
			expect((await store.get("app/ok.gz")).toString()).toBe("hello world");
			const mode = (await stat(path.join(root, "app", "ok.gz"))).mode & 0o777;
			expect(mode).toBe(0o600);

			async function* failing(): AsyncGenerator<Buffer> {
				yield Buffer.from("partial");
				throw new Error("dump failed");
			}
			await expect(store.putStream("app/bad.gz", failing())).rejects.toThrow(/dump failed/);
			await expect(stat(path.join(root, "app", "bad.gz"))).rejects.toThrow();
			await expect(stat(path.join(root, "app", "bad.gz.part"))).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("streams a stored archive back for restores", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "nixploy-stream-"));
		try {
			const store = new LocalBackupStore(root);
			await store.put("app/dump.gz", Buffer.from("restore me"));
			const chunks: Buffer[] = [];
			for await (const chunk of await store.getStream("app/dump.gz")) {
				chunks.push(Buffer.from(chunk as Buffer));
			}
			expect(Buffer.concat(chunks).toString()).toBe("restore me");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
