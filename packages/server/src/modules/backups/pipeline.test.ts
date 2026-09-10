import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	assertNonEmptyGzip,
	buildEncodedPipeline,
	decodePipelineOutput,
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
