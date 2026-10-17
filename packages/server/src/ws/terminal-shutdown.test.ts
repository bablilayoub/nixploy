import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const logs = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../lib/logger", () => ({
	createLogger: () => ({ error: logs.error, debug: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("../lib/auth", () => ({ trustedOriginsWithDashboardDomain: async () => [] }));
vi.mock("./auth", () => ({ getSessionFromUpgrade: vi.fn() }));
vi.mock("./deployment-logs", () => ({ handleDeploymentLogs: vi.fn() }));
vi.mock("./docker-logs", () => ({ handleDockerLogs: vi.fn() }));
vi.mock("./docker-stats", () => ({ handleDockerStats: vi.fn() }));
vi.mock("./docker-terminal", () => ({ handleDockerTerminal: vi.fn() }));
vi.mock("./events", () => ({ handlePlatformEvents: vi.fn() }));
vi.mock("./server-terminal", () => ({ handleServerTerminal: vi.fn() }));

import { closeWebSocketServer } from "./index";
import { attachTerminalExec, drainTerminalExecs, trackTerminalAttachment } from "./terminal-exec";

class FakeSocket extends EventEmitter {
	OPEN = 1;
	readyState = 1;
	bufferedAmount = 0;
	sent: Array<string | Buffer> = [];
	send(data: string | Buffer) {
		this.sent.push(data);
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.emit("close");
	}
	terminate() {
		this.close();
	}
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const cleanups: Array<() => void> = [];
const marker = Buffer.from("\x1eNIXPLOY:shutdown-test:42:98765\x1f");

function execution(
	signal = vi.fn(async (_identity: unknown, _signal: string) => {}),
	delayedTransportClose = false,
) {
	const ws = new FakeSocket();
	const stream = new PassThrough();
	const closeTransport = vi.fn(() => {
		if (!delayedTransportClose) stream.destroy();
	});
	attachTerminalExec({
		ws: ws as unknown as WebSocket,
		stream,
		nonce: "shutdown-test",
		closeTransport,
		signal,
	});
	cleanups.push(() => {
		ws.close();
		stream.destroy();
	});
	return { ws, stream, signal, closeTransport };
}

beforeEach(() => {
	vi.useFakeTimers();
	logs.error.mockClear();
});

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	await vi.advanceTimersByTimeAsync(200);
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("bounded terminal shutdown", () => {
	it("keeps WebSocket shutdown pending until a slow HUP and guarded KILL finish", async () => {
		const hup = deferred();
		const signal = vi.fn(async (_identity: unknown, kind: string) => {
			if (kind === "HUP") await hup.promise;
		});
		const fixture = execution(signal);
		fixture.stream.write(marker);
		let finished = false;
		const shutdown = closeWebSocketServer().then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(1_200);
		expect(finished).toBe(false);
		expect(signal.mock.calls.map((call) => call[1])).toEqual(["HUP"]);
		hup.resolve();
		await vi.advanceTimersByTimeAsync(150);
		await shutdown;
		expect(signal.mock.calls.map((call) => call[1])).toEqual(["HUP", "KILL"]);
		expect(finished).toBe(true);
		expect(logs.error).not.toHaveBeenCalled();
	});

	it("waits for a cancelled identity reader whose marker arrives after the old grace", async () => {
		const fixture = execution();
		let finished = false;
		const shutdown = closeWebSocketServer().then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(1_200);
		expect(finished).toBe(false);
		expect(fixture.closeTransport).not.toHaveBeenCalled();
		fixture.stream.write(marker);
		await vi.advanceTimersByTimeAsync(150);
		await shutdown;
		expect(fixture.signal.mock.calls.map((call) => call[1])).toEqual(["HUP", "KILL"]);
		expect(fixture.ws.sent).toEqual([]);
		expect(fixture.closeTransport).toHaveBeenCalledTimes(1);
	});

	it("includes a helper created by an attachment that completes after shutdown begins", async () => {
		const attached = deferred();
		let fixture: ReturnType<typeof execution> | undefined;
		trackTerminalAttachment(
			attached.promise.then(() => {
				fixture = execution();
				fixture.stream.write(marker);
			}),
		);
		let finished = false;
		const shutdown = closeWebSocketServer().then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(1_200);
		expect(finished).toBe(false);
		attached.resolve();
		await vi.advanceTimersByTimeAsync(150);
		await shutdown;
		expect(fixture?.signal.mock.calls.map((call) => call[1])).toEqual(["HUP", "KILL"]);
		expect(fixture?.ws.sent).toEqual([]);
	});

	it("uses one six-second deadline and reports an unresponsive signal without waiting forever", async () => {
		const hup = deferred();
		const fixture = execution(
			vi.fn(async (_identity: unknown, kind: string) => {
				if (kind === "HUP") await hup.promise;
			}),
		);
		fixture.stream.write(marker);
		let finished = false;
		const shutdown = drainTerminalExecs().then((result) => {
			finished = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(5_999);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await shutdown).toMatchObject({ timedOut: true, pendingExecutions: 1 });
		expect(logs.error).toHaveBeenCalledWith(
			"Terminal cleanup did not complete cleanly before shutdown",
			expect.objectContaining({ timedOut: true, pendingExecutions: 1 }),
		);
		hup.resolve();
		await vi.advanceTimersByTimeAsync(150);
	});

	it("reports a stalled attachment at the same deadline", async () => {
		const attached = deferred();
		trackTerminalAttachment(attached.promise);
		const shutdown = drainTerminalExecs();
		await vi.advanceTimersByTimeAsync(6_000);
		expect(await shutdown).toMatchObject({ timedOut: true, pendingAttachments: 1 });
		attached.resolve();
		await vi.advanceTimersByTimeAsync(0);
	});

	it("does not restart the shutdown budget when an attachment creates a late helper", async () => {
		const attached = deferred();
		const hup = deferred();
		trackTerminalAttachment(
			attached.promise.then(() => {
				const fixture = execution(
					vi.fn(async (_identity: unknown, kind: string) => {
						if (kind === "HUP") await hup.promise;
					}),
				);
				fixture.stream.write(marker);
			}),
		);
		let finished = false;
		const shutdown = drainTerminalExecs().then((result) => {
			finished = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(5_500);
		attached.resolve();
		await vi.advanceTimersByTimeAsync(499);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await shutdown).toMatchObject({
			timedOut: true,
			pendingExecutions: 1,
			pendingAttachments: 0,
		});
		hup.resolve();
		await vi.advanceTimersByTimeAsync(150);
	});

	it("reports an unidentified shell at its startup deadline without guessing a process", async () => {
		const fixture = execution();
		const shutdown = drainTerminalExecs();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(await shutdown).toMatchObject({ timedOut: false, failed: 1 });
		expect(fixture.signal).not.toHaveBeenCalled();
		expect(fixture.closeTransport).toHaveBeenCalledTimes(1);
	});

	it("retains a timed-out identity reader through asynchronous transport close and late cleanup", async () => {
		const hup = deferred();
		const fixture = execution(
			vi.fn(async (_identity: unknown, kind: string) => {
				if (kind === "HUP") await hup.promise;
			}),
			true,
		);
		let finished = false;
		const shutdown = drainTerminalExecs().then((result) => {
			finished = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(5_000);
		expect(fixture.closeTransport).toHaveBeenCalledTimes(1);
		expect(finished).toBe(false);
		fixture.stream.write(marker);
		await vi.advanceTimersByTimeAsync(300);
		expect(finished).toBe(false);
		expect(fixture.signal.mock.calls.map((call) => call[1])).toEqual(["HUP"]);
		hup.resolve();
		await vi.advanceTimersByTimeAsync(150);
		expect(await shutdown).toMatchObject({ timedOut: false, failed: 1 });
		expect(fixture.signal.mock.calls.map((call) => call[1])).toEqual(["HUP", "KILL"]);
		expect(fixture.ws.sent.map(String).join("")).not.toContain('"type":"ready"');
	});

	it("releases an unacknowledged cancelled reader after its bounded post-close grace", async () => {
		const fixture = execution(undefined, true);
		await vi.advanceTimersByTimeAsync(6_000);
		fixture.stream.write(marker);
		expect(fixture.signal).not.toHaveBeenCalled();
		expect(await drainTerminalExecs()).toMatchObject({
			timedOut: false,
			pendingExecutions: 0,
		});
		expect(logs.error).toHaveBeenCalledWith(
			"Terminal identity reader did not close after transport cancellation",
		);
	});

	it("can identify bounded late bytes after rejecting an earlier malformed marker", async () => {
		const fixture = execution(undefined, true);
		fixture.stream.write(Buffer.from("\x1eNIXPLOY:shutdown-test:invalid\x1f"));
		const shutdown = drainTerminalExecs();
		fixture.stream.write(marker);
		await vi.advanceTimersByTimeAsync(150);
		expect(await shutdown).toMatchObject({ timedOut: false, failed: 1 });
		expect(fixture.signal.mock.calls.map((call) => call[1])).toEqual(["HUP", "KILL"]);
		expect(fixture.ws.sent.map(String).join("")).not.toContain('"type":"ready"');
	});

	it("reports a transport failure before the identity was available", async () => {
		const fixture = execution();
		const shutdown = drainTerminalExecs();
		fixture.stream.emit("error", new Error("SSH transport failed before marker"));
		expect(await shutdown).toMatchObject({ timedOut: false, failed: 1 });
		expect(fixture.signal).not.toHaveBeenCalled();
	});

	it("reports failed guarded cleanup rather than marking the drain clean", async () => {
		const fixture = execution(
			vi.fn(async (_identity: unknown, kind: string) => {
				if (kind === "KILL") throw new Error("Docker unavailable");
			}),
		);
		fixture.stream.write(marker);
		const shutdown = drainTerminalExecs();
		await vi.advanceTimersByTimeAsync(150);
		expect(await shutdown).toMatchObject({ timedOut: false, failed: 1 });
		expect(logs.error).toHaveBeenCalledWith(
			"Terminal cleanup did not complete cleanly before shutdown",
			expect.objectContaining({ failed: 1 }),
		);
	});
});
