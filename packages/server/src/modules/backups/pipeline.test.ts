import { spawnSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	assertStreamExit,
	buildStreamPipeline,
	GzipArchiveCheck,
	PIPELINE_EXIT_MARKER,
} from "./pipeline";

describe("buildStreamPipeline / assertStreamExit", () => {
	it("keeps stdout binary and moves the trailer to stderr", () => {
		const command = buildStreamPipeline("pg_dump db");
		expect(command).toContain("| gzip");
		expect(command).toContain(`echo "${PIPELINE_EXIT_MARKER}$(cat "$__nx_rc")" >&2`);
		expect(command).not.toContain("base64");
	});

	it("reports failed producers even when compression succeeds", () => {
		const result = spawnSync("sh", ["-c", buildStreamPipeline("printf partial; false")]);
		expect(result.status).toBe(0);
		expect(gunzipSync(result.stdout).toString()).toBe("partial");
		expect(() => assertStreamExit(result.stderr.toString(), "Dump")).toThrow(/status 1/);
	});

	it("preserves the encoder exit status", () => {
		const result = spawnSync("sh", [
			"-c",
			buildStreamPipeline("printf partial", "cat >/dev/null; exit 9"),
		]);
		expect(result.status).toBe(9);
	});

	it("accepts a zero producer status and refuses anything else", () => {
		expect(() => assertStreamExit(`noise\n${PIPELINE_EXIT_MARKER}0\n`, "Dump")).not.toThrow();
		expect(() => assertStreamExit(`${PIPELINE_EXIT_MARKER}1\n`, "Dump")).toThrow(/status 1/);
		expect(() =>
			assertStreamExit(
				`pg_dump: error: connection failed: the database system is starting up\n${PIPELINE_EXIT_MARKER}1\n`,
				"Dump",
			),
		).toThrow(/status 1 — pg_dump: error: connection failed: the database system is starting up/);
		expect(() => assertStreamExit("no trailer", "Dump")).toThrow(/did not report an exit status/);
	});
});

describe("GzipArchiveCheck", () => {
	it.each(["normal", "padding", "members"])(
		"accepts valid gzip %s without relying on its final ISIZE",
		async (kind) => {
			const data = gzipSync("hello world");
			const archive =
				kind === "padding"
					? Buffer.concat([data, Buffer.alloc(1024)])
					: kind === "members"
						? Buffer.concat([data, gzipSync("second member")])
						: data;
			const check = new GzipArchiveCheck();
			for (let i = 0; i < archive.length; i += 3) await check.update(archive.subarray(i, i + 3));
			await expect(check.assert("Dump")).resolves.toBeUndefined();
			expect(check.byteLength).toBe(archive.length);
		},
	);

	it.each(["empty", "plain", "crc", "truncated"])("refuses %s before publication", async (kind) => {
		const good = gzipSync("nonempty");
		if (kind === "crc") good[good.length - 8] = (good[good.length - 8] ?? 0) ^ 255;
		const archive =
			kind === "empty"
				? gzipSync("")
				: kind === "plain"
					? Buffer.from("plain data")
					: kind === "truncated"
						? good.subarray(0, -3)
						: good;
		const check = new GzipArchiveCheck();
		await expect(
			(async () => {
				await check.update(archive);
				await check.assert("Dump");
			})(),
		).rejects.toThrow();
		check.abort();
	});
});
