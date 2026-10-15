import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildConfigArchiveCommand } from "./instance-backup";
import { buildStreamPipeline, GzipArchiveCheck } from "./pipeline";

it("archives required config without recursive backups, logs or keychain env copies", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "nixploy-config-archive-"));
	try {
		for (const file of [
			".env",
			".env.rotation",
			"backups/org/previous.gz",
			"runtime-logs/app/hour.jsonl",
			"cache/restore.gz",
			"ssh/key",
			"traefik/acme.json",
		]) {
			const target = path.join(dir, file);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, "test fixture");
		}
		const archive = execFileSync(
			"sh",
			["-c", buildStreamPipeline(buildConfigArchiveCommand(dir))],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		// BSD tar's internal gzip pads with zeros, which Apple gzip rejects.
		execFileSync("gzip", ["-t"], { input: archive });
		const check = new GzipArchiveCheck();
		await check.update(archive);
		await check.assert("Config");
		const entries = execFileSync("tar", ["tzf", "-"], { input: archive, encoding: "utf8" });
		expect(entries).toContain("./ssh/key");
		expect(entries).toContain("./traefik/acme.json");
		for (const excluded of [".env", "backups", "runtime-logs", "cache"])
			expect(entries).not.toContain(excluded);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
