import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRedisSnapshotCleanupScript, buildRedisSnapshotScript } from "./instance-backup";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "nixploy-redis-script-"));
	const cli = path.join(dir, "redis-cli");
	await writeFile(
		cli,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$NIXPLOY_TEST_JOURNAL"
case "$*" in
 *"CONFIG GET auto-aof-rewrite-percentage"*) printf 'auto-aof-rewrite-percentage\\n100\\n';;
 *"CONFIG GET dir"*) printf 'dir\\n/data\\n';;
 *"CONFIG SET auto-aof-rewrite-percentage 100"*) [ "$NIXPLOY_TEST_FAILURE" != cleanup ] || exit 5; echo OK;;
 *"CONFIG SET"*) echo OK;;
 *"INFO persistence"*)
  rewrite=0; saving=0; status=ok
  [ "$NIXPLOY_TEST_FAILURE" != rewrite ] || rewrite=1
  [ "$NIXPLOY_TEST_FAILURE" != saving ] || saving=1
  [ "$NIXPLOY_TEST_FAILURE" != status ] || status=err
  printf 'aof_rewrite_in_progress:%s\\nrdb_bgsave_in_progress:%s\\nrdb_last_bgsave_status:%s\\n' "$rewrite" "$saving" "$status";;
 *BGSAVE*|*SAVE*) [ "$NIXPLOY_TEST_FAILURE" != dump ] || exit 2; echo OK;;
 *) exit 8;;
esac
`,
	);
	await chmod(cli, 0o700);
	await writeFile(path.join(dir, "sleep"), "#!/bin/sh\nexit 0\n");
	await chmod(path.join(dir, "sleep"), 0o700);
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function run(command: string, failure = "") {
	return execFileSync("sh", ["-c", command], {
		input: "test-only-password\n",
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			PATH: `${dir}:${process.env.PATH}`,
			NIXPLOY_TEST_JOURNAL: path.join(dir, "calls"),
			NIXPLOY_TEST_FAILURE: failure,
		},
	});
}

describe("live Redis backup preparation", () => {
	it("disables automatic rewrites and reports prior setting for finally cleanup", async () => {
		expect(run(buildRedisSnapshotScript(1, "manual", path.join(dir, "marker")))).toBe(
			"100\n/data\n",
		);
		run(buildRedisSnapshotCleanupScript("100", "manual", path.join(dir, "marker")));
		const calls = await readFile(path.join(dir, "calls"), "utf8");
		expect(calls).toContain("CONFIG SET auto-aof-rewrite-percentage 0");
		expect(calls.trim().split("\n").at(-1)).toContain("CONFIG SET auto-aof-rewrite-percentage 100");
	});
	it.each(["rewrite", "saving", "status", "dump"])(
		"fails %s preparation and restores prior setting",
		async (failure) => {
			expect(() =>
				run(buildRedisSnapshotScript(1, "manual", path.join(dir, "marker")), failure),
			).toThrow();
			expect((await readFile(path.join(dir, "calls"), "utf8")).trim().split("\n").at(-1)).toContain(
				"CONFIG SET auto-aof-rewrite-percentage 100",
			);
		},
	);
	it("does not swallow a reset failure or allow config injection", () => {
		expect(run(buildRedisSnapshotScript(1, "manual", path.join(dir, "marker")))).toBe(
			"100\n/data\n",
		);
		expect(() =>
			run(buildRedisSnapshotCleanupScript("100", "manual", path.join(dir, "marker")), "cleanup"),
		).toThrow();
		expect(() => buildRedisSnapshotCleanupScript("100; touch /tmp/unsafe")).toThrow();
	});
});
