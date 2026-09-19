import { describe, expect, it } from "vitest";
import {
	compareDockerTs,
	demuxDockerLogs,
	dockerSinceParam,
	encodeLogLine,
	parseLogLines,
	splitDockerLogLines,
	toRuntimeLogLines,
} from "./format";

const frame = (type: number, text: string): Buffer => {
	const body = Buffer.from(text, "utf8");
	const header = Buffer.alloc(8);
	header[0] = type;
	header.writeUInt32BE(body.length, 4);
	return Buffer.concat([header, body]);
};

describe("runtime log format", () => {
	it("demuxes a non-TTY stream and passes a TTY stream through", () => {
		const muxed = Buffer.concat([
			frame(1, "2026-09-19T21:00:00.000000001Z out\n"),
			frame(2, "2026-09-19T21:00:00.000000002Z err\n"),
		]);
		expect(demuxDockerLogs(muxed)).toBe(
			"2026-09-19T21:00:00.000000001Z out\n2026-09-19T21:00:00.000000002Z err\n",
		);
		const tty = Buffer.from("2026-09-19T21:00:00.000000001Z raw\n");
		expect(demuxDockerLogs(tty)).toBe("2026-09-19T21:00:00.000000001Z raw\n");
	});

	it("splits timestamped lines and folds continuation lines into the previous entry", () => {
		const lines = splitDockerLogLines(
			[
				"orphan continuation",
				"2026-09-19T21:00:00.123456789Z Error: boom",
				"    at main (index.js:1)",
				"2026-09-19T21:00:01.000000000Z ready\r",
			].join("\n"),
		);
		expect(lines).toEqual([
			{
				ts: "2026-09-19T21:00:00.123456789Z",
				t: Date.parse("2026-09-19T21:00:00.123Z"),
				message: "Error: boom\n    at main (index.js:1)",
			},
			{
				ts: "2026-09-19T21:00:01.000000000Z",
				t: Date.parse("2026-09-19T21:00:01Z"),
				message: "ready",
			},
		]);
	});

	it("orders Docker timestamps and renders the Engine API since parameter", () => {
		expect(
			compareDockerTs("2026-09-19T21:00:00.000000001Z", "2026-09-19T21:00:00.000000002Z"),
		).toBe(-1);
		expect(compareDockerTs("2026-09-19T21:00:00Z", "2026-09-19T21:00:00.000000000Z")).toBe(0);
		expect(dockerSinceParam("2026-09-19T21:00:00.123456789Z")).toBe("1789851600.123456789");
		expect(dockerSinceParam("2026-09-19T21:00:00Z")).toBe("1789851600.000000000");
	});

	it("round-trips stored lines and skips a torn one", () => {
		const stored = toRuntimeLogLines(
			[
				{ ts: "x", t: 1, message: "[warn] disk almost full" },
				{ ts: "y", t: 2, message: "listening on :3000" },
			],
			"web",
		);
		expect(stored).toEqual([
			{ t: 1, level: "warn", message: "disk almost full", container: "web" },
			{ t: 2, level: "default", message: "listening on :3000", container: "web" },
		]);
		const text = `${stored.map(encodeLogLine).join("\n")}\n{"t":3,"l":"info","m":"tor`;
		expect(parseLogLines(text)).toEqual(stored);
	});
});
