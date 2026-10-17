import { describe, expect, it } from "vitest";

import { terminalInputFrames } from "./terminal-input";

function decodeBoundedFrames(input: string): string[] {
	const frames = terminalInputFrames(input);
	for (const frame of frames) {
		expect(new TextEncoder().encode(frame).byteLength).toBeLessThanOrEqual(50 * 1024);
		expect(JSON.parse(frame)).toEqual({ type: "stdin", data: expect.any(String) });
	}
	const chunks = frames.map((frame) => (JSON.parse(frame) as { data: string }).data);
	expect(chunks.join("")).toBe(input);
	return chunks;
}

describe("terminal stdin frames", () => {
	it("keeps a normal keystroke or command in one frame", () => {
		expect(decodeBoundedFrames("pwd\r")).toEqual(["pwd\r"]);
		expect(terminalInputFrames("")).toEqual([]);
	});

	it("splits a paste larger than the server's message limit without changing its order", () => {
		const input = "0123456789abcdefghijklmnopqrstuvwxyz\n".repeat(8_000);
		expect(new TextEncoder().encode(input).byteLength).toBeGreaterThan(64 * 1024);
		expect(decodeBoundedFrames(input).length).toBeGreaterThan(1);
	});

	it("bounds the encoded JSON bytes even when every character needs escaping", () => {
		for (const input of ["\u0000\u0001\u001f".repeat(40_000), '\b\f\n\r\t"\\'.repeat(20_000)]) {
			expect(decodeBoundedFrames(input).length).toBeGreaterThan(1);
		}
	});

	it("preserves multilingual text and never splits a Unicode surrogate pair", () => {
		const input = "a🧪".repeat(20_000) + "日本語 العربية café\r".repeat(2_000);
		const chunks = decodeBoundedFrames(input);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk).not.toMatch(/[\ud800-\udfff]/u);
		}
	});

	it("preserves lone surrogate code units while JSON escapes them within the byte limit", () => {
		const input = "\ud800x\udfff".repeat(30_000);
		expect(decodeBoundedFrames(input).length).toBeGreaterThan(1);
	});
});
