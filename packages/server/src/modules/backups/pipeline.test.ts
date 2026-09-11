import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	assertNonEmptyGzip,
	assertStreamExit,
	buildEncodedPipeline,
	buildStreamPipeline,
	decodePipelineOutput,
	GzipShapeCheck,
	PIPELINE_EXIT_MARKER,
} from "./pipeline";

const runSh = (command: string) => execFileSync("sh", ["-c", command], { encoding: "utf8" });

describe("buildEncodedPipeline", () => {
	it("prints the encoded payload followed by the producer's exit status", () => {
		const out = runSh(buildEncodedPipeline("printf hello"));
		expect(out).toContain(`${PIPELINE_EXIT_MARKER}0`);
		const archive = decodePipelineOutput(out, "test");
		expect(archive[0]).toBe(0x1f);
		expect(archive[1]).toBe(0x8b);
	});

	it("surfaces a failed producer even though gzip and base64 succeed", () => {
		const out = runSh(buildEncodedPipeline("false"));
		expect(out).toContain(`${PIPELINE_EXIT_MARKER}1`);
		expect(() => decodePipelineOutput(out, "Dump of db")).toThrow(/exited with status 1/);
	});

	it("supports a custom encoder for producers that already compress", () => {
		const command = buildEncodedPipeline("printf hi | gzip", "base64");
		const archive = decodePipelineOutput(runSh(command), "test");
		expect(() => assertNonEmptyGzip(archive, "test")).not.toThrow();
	});
});

describe("decodePipelineOutput", () => {
	it("rejects output without the exit trailer (encoder failed)", () => {
		expect(() => decodePipelineOutput("aGVsbG8=\n", "Dump")).toThrow(/did not report/);
	});

	it("ignores whitespace inside the base64 payload", () => {
		const raw = `aGVs\nbG8=\n${PIPELINE_EXIT_MARKER}0\n`;
		expect(decodePipelineOutput(raw, "Dump").toString("utf8")).toBe("hello");
	});
});

describe("assertNonEmptyGzip", () => {
	it("accepts a gzip archive with content", () => {
		expect(() => assertNonEmptyGzip(gzipSync(Buffer.from("CREATE TABLE t();")), "x")).not.toThrow();
	});

	it("rejects an archive that gunzips to 0 bytes", () => {
		expect(() => assertNonEmptyGzip(gzipSync(Buffer.alloc(0)), "Dump of db")).toThrow(/empty/);
	});

	it("rejects non-gzip and truncated buffers", () => {
		expect(() => assertNonEmptyGzip(Buffer.from("plain sql"), "x")).toThrow(/not a gzip/);
		expect(() => assertNonEmptyGzip(Buffer.alloc(0), "x")).toThrow(/not a gzip/);
	});
});

describe("buildStreamPipeline / assertStreamExit", () => {
	it("keeps stdout binary and moves the trailer to stderr", () => {
		const command = buildStreamPipeline("pg_dump db");
		expect(command).toContain("| gzip");
		expect(command).toContain(`echo "${PIPELINE_EXIT_MARKER}$(cat "$__nx_rc")" >&2`);
		expect(command).not.toContain("base64");
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

describe("GzipShapeCheck", () => {
	const gzipOf = (payload: string): Buffer => gzipSync(Buffer.from(payload));

	it("accepts a real gzip stream fed in small chunks", () => {
		const archive = gzipOf("hello world, this is a dump");
		const check = new GzipShapeCheck();
		for (let i = 0; i < archive.length; i += 3) {
			check.update(archive.subarray(i, i + 3));
		}
		expect(() => check.assert("Dump")).not.toThrow();
		expect(check.byteLength).toBe(archive.length);
	});

	it("refuses a non-gzip stream and an empty member", () => {
		const plain = new GzipShapeCheck();
		plain.update(Buffer.from("not gzip at all, really not gzip"));
		expect(() => plain.assert("Dump")).toThrow(/not a gzip archive/);

		const empty = new GzipShapeCheck();
		empty.update(gzipOf(""));
		expect(() => empty.assert("Dump")).toThrow(/empty/);
	});
});
