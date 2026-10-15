import { execFileSync, spawnSync } from "node:child_process";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildVolumeReplacementScript } from "./restore-commands";

let dir: string;
let volume: string;
const token = "0123456789abcdef01234567";
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

describe("stopped volume replacement", () => {
	it("replaces all old children, including stale AOF/hidden state", async () => {
		execFileSync("sh", ["-c", buildVolumeReplacementScript(volume, token)], {
			input: await payload(),
		});
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
		execFileSync("sh", ["-c", buildVolumeReplacementScript(volume, token)], { input: archive });
		expect((await stat(volume)).mode & 0o777).toBe(0o700);
		expect(await readlink(path.join(volume, "safe-link"))).toBe("new");
		expect((await stat(path.join(volume, "hard-link"))).ino).toBe(
			(await stat(path.join(volume, "new"))).ino,
		);
	});

	it("unwraps a Redis data subtree and removes absent old persistence files", async () => {
		execFileSync("sh", ["-c", buildVolumeReplacementScript(volume, token, "data")], {
			input: await payload("data"),
		});
		expect(await readdir(volume)).toEqual(["dump.rdb"]);
	});

	it("preserves the original tree when extraction fails", async () => {
		const result = spawnSync("sh", ["-c", buildVolumeReplacementScript(volume, token)], {
			input: "not tar",
		});
		expect(result.status).not.toBe(0);
		expect((await readdir(volume)).sort()).toEqual([".old-hidden", "old"]);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
	});

	it("rolls back a failed new-tree move without losing old bytes", async () => {
		const result = spawnSync("sh", ["-c", buildVolumeReplacementScript(volume, token)], {
			input: await payload(),
			env: await failMoves(3, false),
		});
		expect(result.status).not.toBe(0);
		expect((await readdir(volume)).sort()).toEqual([".old-hidden", "old"]);
		expect(await readFile(path.join(volume, "old"), "utf8")).toBe("original marker");
	});

	it("retains old and staged bytes with recovery guidance if rollback fails", async () => {
		const result = spawnSync("sh", ["-c", buildVolumeReplacementScript(volume, token)], {
			input: await payload(),
			env: await failMoves(3, true),
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr.toString()).toContain("previous data retained");
		expect(await readFile(path.join(volume, `.nixploy-previous-${token}`, "old"), "utf8")).toBe(
			"original marker",
		);
		expect(await readFile(path.join(volume, `.nixploy-restore-${token}`, "new"), "utf8")).toBe(
			"selected marker",
		);
	});
});
