import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	chmod,
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildVolumeArchiveScript,
	buildVolumeReplacementScript,
	buildVolumeRestoreLockScript,
} from "./restore-commands";

let dir: string;
let volume: string;
const token = "0123456789abcdef01234567";
const otherToken = "abcdef0123456789abcdef01";
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "nixploy-replace-"));
	volume = path.join(dir, "volume");
	await mkdir(volume);
	await writeFile(path.join(volume, "old"), "original marker");
	await writeFile(path.join(volume, ".old-hidden"), "hidden marker");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function payload(subtree?: "data"): Promise<Buffer> {
	const source = path.join(dir, "source");
	const root = subtree ? path.join(source, subtree) : source;
	await mkdir(root, { recursive: true });
	await writeFile(path.join(root, subtree ? "dump.rdb" : "new"), "selected marker");
	return execFileSync("tar", ["czf", "-", "-C", source, "."]);
}

async function failMoves(after: number, repeatedly: boolean) {
	const bin = path.join(dir, "bin");
	await mkdir(bin);
	const wrapper = path.join(bin, "mv");
	await writeFile(
		wrapper,
		`#!/bin/sh\nn=0; [ ! -f "$NIXPLOY_TEST_COUNTER" ] || n=$(cat "$NIXPLOY_TEST_COUNTER"); n=$((n+1)); echo "$n" > "$NIXPLOY_TEST_COUNTER"; if [ "$n" ${repeatedly ? "-ge" : "-eq"} ${after} ]; then exit 9; fi; exec /bin/mv "$@"\n`,
	);
	await chmod(wrapper, 0o700);
	return {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		NIXPLOY_TEST_COUNTER: path.join(dir, "counter"),
	};
}

function lock(action: "acquire" | "activate" | "finish-read" | "release", owner = token) {
	return spawnSync("sh", ["-c", buildVolumeRestoreLockScript(volume, owner, action)]);
}

function replace(input: Buffer | string, options?: { subtree?: "data"; env?: NodeJS.ProcessEnv }) {
	const acquired = lock("acquire");
	if (acquired.status !== 0) return acquired;
	const activated = lock("activate");
	if (activated.status !== 0) return activated;
	const result = spawnSync(
		"sh",
		["-c", buildVolumeReplacementScript(volume, token, options?.subtree)],
		{ input, env: options?.env },
	);
	const released = lock("release");
	return result.status !== 0 ? result : released;
}

async function heldReplacement(input: Buffer, archiveRead = false) {
	const bin = path.join(dir, "bin");
	const held = path.join(dir, "held");
	const gate = path.join(dir, "gate");
	const tar = execFileSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).trim();
	await mkdir(bin);
	await writeFile(
		path.join(bin, "tar"),
		`#!/bin/sh\n: > "$NIXPLOY_TEST_HELD"\nwhile [ ! -f "$NIXPLOY_TEST_GATE" ]; do sleep 0.01; done\nexec "${tar}" "$@"\n`,
		{ mode: 0o700 },
	);
	expect(lock("acquire").status).toBe(0);
	expect(lock("activate").status).toBe(0);
	const script = archiveRead
		? buildVolumeArchiveScript(volume, token)
		: buildVolumeReplacementScript(volume, token);
	const child = spawn("sh", ["-c", script], {
		detached: true,
		stdio: ["pipe", "ignore", "pipe"],
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			NIXPLOY_TEST_HELD: held,
			NIXPLOY_TEST_GATE: gate,
		},
	});
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const done = new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (status) => resolve({ status, stderr }));
	});
	child.stdin.on("error", () => {});
	child.stdin.end(input);
	for (let attempt = 0; attempt < 200; attempt++) {
		if (await stat(held).catch(() => null)) return { child, done, gate };
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	if (child.pid) process.kill(-child.pid, "SIGKILL");
	await done;
	throw new Error("Replacement never reached its held extraction");
}

describe("stopped volume replacement", () => {
	it("refuses a restore fenced by another operation before touching its data", async () => {
		const lock = path.join(volume, ".nixploy-restore-lock");
		await mkdir(lock);
		await writeFile(path.join(lock, "owner"), "another operation");
		const result = replace(await payload());
		expect(result.status).not.toBe(0);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		expect(await readFile(path.join(lock, "owner"), "utf8")).toBe("another operation");
	});

	it.each([".nixploy-previous-deadbeef", ".nixploy-restore-deadbeef"])(
		"refuses unrecovered %s without moving or deleting it",
		async (name) => {
			const previous = path.join(volume, name);
			await mkdir(previous);
			await writeFile(path.join(previous, "recover-me"), "irreplaceable marker");
			const result = replace(await payload());
			expect(result.status).not.toBe(0);
			expect(await readFile(path.join(previous, "recover-me"), "utf8")).toBe(
				"irreplaceable marker",
			);
			expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		},
	);

	it("replaces all old children, including stale AOF/hidden state", async () => {
		expect(replace(await payload()).status).toBe(0);
		expect(await readdir(volume)).toEqual(["new"]);
		expect(await readFile(path.join(volume, "new"), "utf8")).toBe("selected marker");
	});

	it("preserves root mode and confined symbolic/hard links", async () => {
		await payload();
		const source = path.join(dir, "source");
		await chmod(source, 0o700);
		await symlink("new", path.join(source, "safe-link"));
		await link(path.join(source, "new"), path.join(source, "hard-link"));
		const archive = execFileSync("tar", ["czf", "-", "-C", source, "."]);
		expect(replace(archive).status).toBe(0);
		expect((await stat(volume)).mode & 0o777).toBe(0o700);
		expect(await readlink(path.join(volume, "safe-link"))).toBe("new");
		expect((await stat(path.join(volume, "hard-link"))).ino).toBe(
			(await stat(path.join(volume, "new"))).ino,
		);
	});

	it("unwraps a Redis data subtree and removes absent old persistence files", async () => {
		expect(replace(await payload("data"), { subtree: "data" }).status).toBe(0);
		expect(await readdir(volume)).toEqual(["dump.rdb"]);
	});

	it("preserves the original tree when extraction fails", async () => {
		const result = replace("not tar");
		expect(result.status).not.toBe(0);
		expect((await readdir(volume)).sort()).toEqual([".old-hidden", "old"]);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
	});

	it("rolls back a failed new-tree move without losing old bytes", async () => {
		const result = replace(await payload(), { env: await failMoves(3, false) });
		expect(result.status).not.toBe(0);
		expect((await readdir(volume)).sort()).toEqual([".old-hidden", "old"]);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
	});

	it("retains old and staged bytes with recovery guidance if rollback fails", async () => {
		const result = replace(await payload(), { env: await failMoves(3, true) });
		expect(result.status).not.toBe(0);
		expect(result.stderr.toString()).toContain("previous data retained");
		expect(await readFile(path.join(volume, `.nixploy-previous-${token}`, "old"), "utf8")).toBe(
			"original marker",
		);
		expect(await readFile(path.join(volume, `.nixploy-restore-${token}`, "new"), "utf8")).toBe(
			"selected marker",
		);
		expect(await readFile(path.join(volume, ".nixploy-restore-lock", "owner"), "utf8")).toBe(
			`${token}\n`,
		);
		expect(lock("acquire", otherToken).status).not.toBe(0);
	});

	it("serializes two real POSIX helpers before the second can mutate the volume", async () => {
		const held = await heldReplacement(await payload());
		try {
			const second = lock("acquire", otherToken);
			expect(second.status).not.toBe(0);
			expect(second.stderr.toString()).toContain("Volume restore is locked");
			const competingReader = spawnSync("sh", ["-c", buildVolumeArchiveScript(volume, otherToken)]);
			expect(competingReader.status).not.toBe(0);
			expect(competingReader.stdout).toHaveLength(0);
			expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
			// Even the owning caller cannot release a still-active helper.
			expect(lock("release").status).not.toBe(0);
			await writeFile(held.gate, "continue");
			expect((await held.done).status).toBe(0);
			expect(lock("release").status).toBe(0);
			expect(await readdir(volume)).toEqual(["new"]);
		} finally {
			await writeFile(held.gate, "continue");
			await held.done;
		}
	});

	it("keeps a crashed helper fenced, including its staged bytes", async () => {
		const held = await heldReplacement(await payload());
		if (!held.child.pid) throw new Error("Missing helper pid");
		process.kill(-held.child.pid, "SIGKILL");
		expect((await held.done).status).not.toBe(0);
		expect(lock("release").status).not.toBe(0);
		expect(lock("acquire", otherToken).status).not.toBe(0);
		expect(await readFile(path.join(volume, ".nixploy-restore-lock", "owner"), "utf8")).toBe(
			`${token}\n`,
		);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		expect(await stat(path.join(volume, `.nixploy-restore-${token}`))).toBeDefined();
	});

	it("never releases a marker owned by another token", async () => {
		expect(lock("acquire").status).toBe(0);
		expect(lock("release", otherToken).status).not.toBe(0);
		expect(await readFile(path.join(volume, ".nixploy-restore-lock", "owner"), "utf8")).toBe(
			`${token}\n`,
		);
		expect(lock("release").status).toBe(0);
		expect((await readdir(volume)).sort()).toEqual([".old-hidden", "old"]);
	});

	it("retains the fence when a transport fails before the helper enters", async () => {
		expect(lock("acquire").status).toBe(0);
		expect(lock("activate").status).toBe(0);
		expect(lock("release").status).not.toBe(0);
		expect(lock("acquire", otherToken).status).not.toBe(0);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		expect(await readdir(path.join(volume, ".nixploy-restore-lock"))).toEqual(["active", "owner"]);
	});

	it("does not clean up another owner's marker if ownership changes during extraction", async () => {
		const held = await heldReplacement(await payload());
		try {
			await writeFile(path.join(volume, ".nixploy-restore-lock", "owner"), `${otherToken}\n`);
			await writeFile(held.gate, "continue");
			const result = await held.done;
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("ownership changed");
			expect(lock("release").status).not.toBe(0);
			expect(await readFile(path.join(volume, ".nixploy-restore-lock", "owner"), "utf8")).toBe(
				`${otherToken}\n`,
			);
			expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		} finally {
			await writeFile(held.gate, "continue");
			await held.done;
		}
	});
});

describe("volume archive fence", () => {
	it("excludes only its owned root marker and produces a restorable archive", async () => {
		await mkdir(path.join(volume, "application", ".nixploy-restore-lock"), { recursive: true });
		await writeFile(path.join(volume, "application", ".nixploy-restore-lock", "data"), "user data");
		expect(lock("acquire").status).toBe(0);
		expect(lock("activate").status).toBe(0);
		const tar = execFileSync("sh", ["-c", buildVolumeArchiveScript(volume, token)]);
		const names = execFileSync("tar", ["tf", "-"], { input: tar, encoding: "utf8" }).split("\n");
		expect(names).not.toContain("./.nixploy-restore-lock/");
		expect(names).not.toContain("./.nixploy-restore-lock/owner");
		expect(names).toContain("./application/.nixploy-restore-lock/data");
		// Upload completion is outside the reader; its fence still holds.
		expect(lock("release").status).not.toBe(0);
		expect(lock("finish-read").status).toBe(0);
		expect(lock("release").status).toBe(0);
		await writeFile(path.join(volume, "old"), "changed after backup");
		await writeFile(path.join(volume, "stale"), "remove on restore");
		expect(replace(gzipSync(tar)).status).toBe(0);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
		expect(
			await readFile(path.join(volume, "application", ".nixploy-restore-lock", "data"), "utf8"),
		).toBe("user data");
		expect(await stat(path.join(volume, "stale")).catch(() => null)).toBeNull();
	});

	it("blocks a competing restore while a real archive reader is held", async () => {
		const held = await heldReplacement(Buffer.alloc(0), true);
		try {
			expect(lock("acquire", otherToken).status).not.toBe(0);
			const competing = spawnSync("sh", ["-c", buildVolumeReplacementScript(volume, otherToken)], {
				input: await payload(),
			});
			expect(competing.status).not.toBe(0);
			expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
			await writeFile(held.gate, "continue");
			expect((await held.done).status).toBe(0);
			expect(lock("finish-read").status).toBe(0);
			expect(lock("release").status).toBe(0);
		} finally {
			await writeFile(held.gate, "continue");
			await held.done;
		}
	});

	it("rejects newly discovered recovery trees before yielding archive bytes", async () => {
		expect(lock("acquire").status).toBe(0);
		expect(lock("activate").status).toBe(0);
		await mkdir(path.join(volume, ".nixploy-previous-unrecovered"));
		const read = spawnSync("sh", ["-c", buildVolumeArchiveScript(volume, token)]);
		expect(read.status).not.toBe(0);
		expect(read.stdout).toHaveLength(0);
		expect(lock("finish-read").status).not.toBe(0);
		expect(lock("release").status).not.toBe(0);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
	});
});
