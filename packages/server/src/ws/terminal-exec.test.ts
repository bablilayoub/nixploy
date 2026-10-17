import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { attachTerminalExec, terminalExecCommand, terminalSignalCommand } from "./terminal-exec";

const NONCE = "terminal-unit-nonce";
const IDENTITY = { pid: "42", startTime: "90071992547409930001" };
const marker = (pid = IDENTITY.pid, start = IDENTITY.startTime, nonce = NONCE) =>
	Buffer.from(`\x1eNIXPLOY:${nonce}:${pid}:${start}\x1f`);

class FakeSocket extends EventEmitter {
	OPEN = 1;
	readyState = 1;
	bufferedAmount = 0;
	sent: Array<string | Buffer> = [];
	closeCodes: number[] = [];
	send(data: string | Buffer) {
		this.sent.push(data);
	}
	close(code = 1000) {
		if (this.readyState === 3) return;
		this.closeCodes.push(code);
		this.readyState = 3;
		this.emit("close");
	}
	terminate() {
		this.close();
	}
}

function fixture(closed = false) {
	const ws = new FakeSocket();
	if (closed) ws.close();
	const stream = new PassThrough();
	const closeTransport = vi.fn(() => stream.destroy());
	const signal = vi.fn(async () => {});
	const lifecycle = attachTerminalExec({
		ws: ws as unknown as WebSocket,
		stream,
		nonce: NONCE,
		closeTransport,
		signal,
	});
	return { ws, stream, closeTransport, signal, lifecycle };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("terminal exec private startup identity", () => {
	it.each([1, 2, 15, 30])("consumes a marker split at byte %i before announcing ready", (split) => {
		const { ws, stream, lifecycle } = fixture();
		const identity = marker();
		stream.write(identity.subarray(0, split));
		expect(ws.sent).toEqual([]);
		expect(lifecycle.isReady()).toBe(false);
		stream.write(Buffer.concat([identity.subarray(split), Buffer.from("/data # ")]));
		expect(ws.sent).toEqual(['{"type":"ready"}', Buffer.from("/data # ")]);
		expect(lifecycle.isReady()).toBe(true);
		stream.write(Buffer.from("ordinary output"));
		expect(ws.sent.at(-1)).toEqual(Buffer.from("ordinary output"));
		expect(ws.sent.map(String).join("")).not.toContain(IDENTITY.startTime);
	});

	it("strips startup preamble and the complete private marker from shell output", () => {
		const { ws, stream } = fixture();
		stream.write(
			Buffer.concat([Buffer.from("private startup preamble"), marker(), Buffer.from("ok")]),
		);
		expect(ws.sent).toEqual(['{"type":"ready"}', Buffer.from("ok")]);
	});

	it.each([
		["0", "55"],
		["1", "55"],
		["-2", "55"],
		["42", "invalid"],
		["12345678901", "55"],
		["42", "123456789012345678901"],
	])("rejects an unsafe process identity %s/%s without signaling", (pid, start) => {
		const { ws, stream, lifecycle, signal, closeTransport } = fixture();
		stream.write(marker(pid, start));
		expect(lifecycle.isReady()).toBe(false);
		expect(ws.sent).toEqual([
			JSON.stringify({ type: "error", message: "Invalid terminal shell identity" }),
		]);
		expect(ws.closeCodes).toEqual([1008]);
		expect(closeTransport).toHaveBeenCalledTimes(1);
		expect(signal).not.toHaveBeenCalled();
	});

	it("never accepts another session's nonce and bounds an unfinished startup prefix", () => {
		const { ws, stream, signal, closeTransport, lifecycle } = fixture();
		stream.write(marker("42", "55", "another-session"));
		expect(ws.sent).toEqual([]);
		stream.write(Buffer.alloc(4097, 65));
		expect(lifecycle.isReady()).toBe(false);
		expect(ws.sent).toEqual([
			JSON.stringify({ type: "error", message: "Could not identify the terminal shell" }),
		]);
		expect(closeTransport).toHaveBeenCalledTimes(1);
		expect(signal).not.toHaveBeenCalled();
	});

	it("ends an unidentified startup after its deadline without guessing a PID", async () => {
		const { ws, lifecycle, signal, closeTransport } = fixture();
		await vi.advanceTimersByTimeAsync(5000);
		expect(lifecycle.isReady()).toBe(false);
		expect(ws.sent).toEqual([
			JSON.stringify({
				type: "error",
				message: "The terminal did not identify its shell. Start a new session to retry.",
			}),
		]);
		expect(closeTransport).toHaveBeenCalledTimes(1);
		expect(signal).not.toHaveBeenCalled();
	});

	it("reports an early stream exit without ready or a guessed cleanup identity", () => {
		const { ws, stream, signal, closeTransport, lifecycle } = fixture();
		stream.emit("end");
		expect(lifecycle.isReady()).toBe(false);
		expect(ws.sent).toEqual([
			JSON.stringify({
				type: "error",
				message: "The terminal shell closed before it became ready.",
			}),
		]);
		expect(ws.closeCodes).toEqual([1000]);
		expect(closeTransport).toHaveBeenCalledTimes(1);
		expect(signal).not.toHaveBeenCalled();
	});
});

describe("terminal exec exact-process teardown", () => {
	it.each([false, true])(
		"consumes a late identity after cancellation (already closed: %s)",
		async (alreadyClosed) => {
			const { ws, stream, signal, closeTransport, lifecycle } = fixture(alreadyClosed);
			if (!alreadyClosed) ws.close();
			expect(signal).not.toHaveBeenCalled();
			expect(closeTransport).not.toHaveBeenCalled();
			stream.write(marker().subarray(0, 9));
			stream.write(marker().subarray(9));
			expect(lifecycle.isReady()).toBe(false);
			expect(ws.sent).toEqual([]);
			expect(signal).toHaveBeenNthCalledWith(1, IDENTITY, "HUP");
			await vi.advanceTimersByTimeAsync(150);
			expect(signal).toHaveBeenNthCalledWith(2, IDENTITY, "KILL");
			expect(closeTransport).toHaveBeenCalledTimes(1);
		},
	);

	it("stops once on unmount and never forwards output after closure", async () => {
		const { ws, stream, signal, closeTransport, lifecycle } = fixture();
		stream.write(marker());
		ws.close();
		ws.emit("close");
		stream.emit("data", Buffer.from("after closed"));
		stream.emit("end");
		stream.emit("close");
		stream.emit("error", new Error("late transport failure"));
		await vi.advanceTimersByTimeAsync(150);
		expect(lifecycle.isReady()).toBe(false);
		expect(ws.sent).toEqual(['{"type":"ready"}']);
		expect(signal.mock.calls).toEqual([
			[IDENTITY, "HUP"],
			[IDENTITY, "KILL"],
		]);
		expect(closeTransport).toHaveBeenCalledTimes(1);
	});

	it.each(["end", "close", "error"])(
		"closes the socket and stops its identified process when the stream emits %s",
		async (event) => {
			const { ws, stream, signal, closeTransport } = fixture();
			stream.write(marker());
			stream.emit(event, ...(event === "error" ? [new Error("transport")] : []));
			await vi.advanceTimersByTimeAsync(150);
			expect(ws.closeCodes).toEqual([event === "error" ? 1011 : 1000]);
			expect(signal.mock.calls).toEqual([
				[IDENTITY, "HUP"],
				[IDENTITY, "KILL"],
			]);
			expect(closeTransport).toHaveBeenCalledTimes(1);
		},
	);

	it("still tries guarded KILL when the HUP transport fails", async () => {
		const { ws, stream, signal } = fixture();
		signal.mockRejectedValueOnce(new Error("temporary HUP transport failure"));
		stream.write(marker());
		ws.close();
		await vi.advanceTimersByTimeAsync(150);
		expect(signal.mock.calls).toEqual([
			[IDENTITY, "HUP"],
			[IDENTITY, "KILL"],
		]);
	});
});

describe("terminal exec commands", () => {
	it("prints a nonce-bound namespace PID/start-time before entering the shell", () => {
		const command = terminalExecCommand(NONCE, "exec sh");
		expect(command).toContain("/proc/$$/stat");
		expect(command).toContain(`NIXPLOY:${NONCE}:%s:%s`);
		expect(command).toContain('"$$" "$1"; exec sh');
	});

	it.each(["", "unsafe:nonce", "nonce\nexit", "$(exit)"])(
		"refuses an unsafe startup nonce %j",
		(nonce) =>
			expect(() => terminalExecCommand(nonce, "exec sh")).toThrow("Invalid terminal nonce"),
	);

	it("passes exact PID/start time as arguments with a guard before signaling", () => {
		const command = terminalSignalCommand(IDENTITY, "HUP");
		expect(command.slice(0, 2)).toEqual(["sh", "-c"]);
		expect(command.slice(3)).toEqual([
			"nixploy-terminal-close",
			IDENTITY.pid,
			IDENTITY.startTime,
			"HUP",
		]);
		expect(command[2]).toMatch(/\[ "\$1" = "\$expected" \] \|\| exit 0; kill/);
	});

	it.each([
		{ pid: "1", startTime: "55" },
		{ pid: "0", startTime: "55" },
		{ pid: "42; kill 1", startTime: "55" },
		{ pid: "42", startTime: "55; exit" },
	])("rejects an unsafe signal identity %j", (identity) => {
		expect(() => terminalSignalCommand(identity, "KILL")).toThrow(/Invalid terminal/);
	});
});
