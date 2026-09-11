import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server host terminal, exercised against a fake ssh2 client.
 *
 * No real host is involved: these tests pin the authorization gate (the part
 * that must never regress), the frame wiring and the idle timeout. Whether a
 * real `sshd` hands us a usable PTY is not something a unit test can answer —
 * see the scope report for what was and was not verified live.
 */

const hoisted = vi.hoisted(() => {
	const shellMock = vi.fn();
	const releaseMock = vi.fn();
	const channelCloseMock = vi.fn();
	const acquireMock = vi.fn();

	/** Handlers the module registered through `lease.onConnectionLost`. */
	const connectionLostHandlers: Array<(error: Error) => void> = [];

	return {
		shellMock,
		releaseMock,
		channelCloseMock,
		acquireMock,
		connectionLostHandlers,
		recordAudit: vi.fn(),
		resolveWsOrganizationId: vi.fn(async () => "org-1"),
		hasCapability: vi.fn(async () => true),
		assertInstanceAdmin: vi.fn(async () => {}),
		findServerById: vi.fn(
			async (): Promise<{ serverId: string; name: string } | undefined> => ({
				serverId: "srv-1",
				name: "edge-1",
			}),
		),
	};
});

vi.mock("../modules/audit", () => ({ recordAudit: hoisted.recordAudit }));
vi.mock("./access", () => ({ resolveWsOrganizationId: hoisted.resolveWsOrganizationId }));
vi.mock("../modules/projects", () => ({ hasCapability: hoisted.hasCapability }));
vi.mock("../modules/auth/instance-admin", () => ({
	assertInstanceAdmin: hoisted.assertInstanceAdmin,
}));
vi.mock("../modules/cluster/servers", () => ({ findServerById: hoisted.findServerById }));
// The pooled SSH transport: a lease is one channel on the shared connection,
// given back with `release()` — the handler must never `end()` the client.
vi.mock("./docker", () => ({ acquireServerSsh: hoisted.acquireMock }));

import {
	assertServerTerminalAccess,
	clampDimension,
	handleServerTerminal,
	IDLE_TIMEOUT_MS,
	parseTerminalInput,
} from "./server-terminal";

/** Minimal WebSocket stand-in recording what the handler sent and how it closed. */
class FakeSocket extends EventEmitter {
	readyState = 1;
	OPEN = 1;
	bufferedAmount = 0;
	sent: Array<string | Buffer> = [];
	closes: Array<{ code: number; reason?: string }> = [];
	terminated = false;
	send(data: string | Buffer) {
		this.sent.push(data);
	}
	close(code: number, reason?: string) {
		this.closes.push({ code, reason });
		this.readyState = 3;
	}
	terminate() {
		this.terminated = true;
	}
	get errorMessage(): string | null {
		for (const frame of this.sent) {
			if (typeof frame !== "string") continue;
			try {
				const parsed = JSON.parse(frame) as { type?: string; message?: string };
				if (parsed.type === "error") return parsed.message ?? null;
			} catch {
				// terminal output
			}
		}
		return null;
	}
	get text(): string {
		return this.sent.map((frame) => frame.toString()).join("");
	}
}

// biome-ignore lint/suspicious/noExplicitAny: the handler only reads `url` off the request.
const request = (url: string): any => ({ url, headers: { host: "panel.test" } });
// biome-ignore lint/suspicious/noExplicitAny: WsSession is a better-auth type; the handler reads two fields.
const session = (): any => ({
	user: { id: "user-1", email: "ops@example.test", role: "admin" },
	session: { activeOrganizationId: "org-1" },
});

let socket: FakeSocket;
let stream: EventEmitter & {
	write: ReturnType<typeof vi.fn>;
	setWindow: ReturnType<typeof vi.fn>;
	stderr: EventEmitter;
};

beforeEach(() => {
	vi.useFakeTimers();
	socket = new FakeSocket();
	stream = Object.assign(new EventEmitter(), {
		write: vi.fn(),
		setWindow: vi.fn(),
		stderr: new EventEmitter(),
		close: hoisted.channelCloseMock,
	});
	hoisted.recordAudit.mockReset();
	hoisted.releaseMock.mockReset();
	hoisted.channelCloseMock.mockReset();
	hoisted.connectionLostHandlers.length = 0;
	hoisted.hasCapability.mockResolvedValue(true);
	hoisted.assertInstanceAdmin.mockResolvedValue(undefined);
	hoisted.findServerById.mockResolvedValue({ serverId: "srv-1", name: "edge-1" });
	// A lease whose `shell()` hands back our stream synchronously.
	hoisted.acquireMock.mockReset();
	hoisted.acquireMock.mockImplementation(async () => ({
		client: { shell: hoisted.shellMock },
		server: { serverId: "srv-1", name: "edge-1", host: "10.0.0.9", port: 22, username: "root" },
		release: hoisted.releaseMock,
		discard: hoisted.releaseMock,
		onConnectionLost: (handler: (error: Error) => void) => {
			hoisted.connectionLostHandlers.push(handler);
		},
	}));
	hoisted.shellMock.mockReset();
	hoisted.shellMock.mockImplementation(
		(_options: unknown, callback: (err: Error | null, stream: unknown) => void) => {
			callback(null, stream);
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
});

/** Drive the handler through the pooled lease. */
async function open(url = "/ws/server-terminal?serverId=srv-1"): Promise<void> {
	await (handleServerTerminal(
		socket as unknown as never,
		request(url),
		session(),
	) as Promise<void>);
}

describe("parseTerminalInput", () => {
	it("accepts stdin and resize frames", () => {
		expect(parseTerminalInput('{"type":"stdin","data":"ls\\n"}')).toEqual({
			type: "stdin",
			data: "ls\n",
		});
		expect(parseTerminalInput('{"type":"resize","cols":120,"rows":40}')).toEqual({
			type: "resize",
			cols: 120,
			rows: 40,
		});
	});

	it("drops anything else", () => {
		expect(parseTerminalInput("not json")).toBeNull();
		expect(parseTerminalInput('{"type":"stdin"}')).toBeNull();
		expect(parseTerminalInput('{"type":"resize","cols":"80","rows":24}')).toBeNull();
		expect(parseTerminalInput('{"type":"exec","data":"rm -rf /"}')).toBeNull();
	});
});

describe("clampDimension", () => {
	it("keeps dimensions inside a sane range", () => {
		expect(clampDimension(120, 80)).toBe(120);
		expect(clampDimension(0, 80)).toBe(80);
		expect(clampDimension(Number.NaN, 24)).toBe(24);
		expect(clampDimension(undefined, 24)).toBe(24);
		expect(clampDimension(99_999, 80)).toBe(1000);
		expect(clampDimension(-5, 80)).toBe(1);
	});
});

describe("assertServerTerminalAccess", () => {
	it("requires the servers.manage capability", async () => {
		hoisted.hasCapability.mockResolvedValue(false);
		await expect(assertServerTerminalAccess(session(), "srv-1")).rejects.toThrow(/servers\.manage/);
	});

	it("requires the instance-admin role on top of the capability", async () => {
		hoisted.assertInstanceAdmin.mockRejectedValue(new Error("instance admin role"));
		await expect(assertServerTerminalAccess(session(), "srv-1")).rejects.toThrow(/instance admin/);
	});

	it("refuses a server outside the caller's organization", async () => {
		hoisted.findServerById.mockResolvedValue(undefined);
		await expect(assertServerTerminalAccess(session(), "srv-other")).rejects.toThrow(
			/Server not found/,
		);
	});
});

describe("handleServerTerminal", () => {
	it("refuses a request without serverId (there is no local host terminal)", async () => {
		await handleServerTerminal(
			socket as unknown as never,
			request("/ws/server-terminal"),
			session(),
		);
		expect(socket.errorMessage).toMatch(/managed remote servers/);
		expect(hoisted.acquireMock).not.toHaveBeenCalled();
	});

	it("closes without connecting when the caller lacks the capability", async () => {
		hoisted.hasCapability.mockResolvedValue(false);
		await open();
		expect(socket.errorMessage).toMatch(/servers\.manage/);
		expect(hoisted.acquireMock).not.toHaveBeenCalled();
		expect(hoisted.recordAudit).not.toHaveBeenCalled();
	});

	it("audits the session and takes one channel on the server's pooled connection", async () => {
		await open();
		expect(hoisted.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "server.terminal.open",
				targetId: "srv-1",
				targetName: "edge-1",
				actorId: "user-1",
			}),
		);
		// The pool owns the handshake and the host-key pin (utils/ssh-pool.ts);
		// this handler only asks it for the server's client.
		expect(hoisted.acquireMock).toHaveBeenCalledWith("srv-1");
		expect(hoisted.shellMock).toHaveBeenCalledWith(
			expect.objectContaining({ term: "xterm-256color" }),
			expect.any(Function),
		);
	});

	it("forwards keystrokes, resizes and output", async () => {
		await open();
		socket.emit("message", Buffer.from('{"type":"stdin","data":"uptime\\n"}'));
		expect(stream.write).toHaveBeenCalledWith("uptime\n");

		socket.emit("message", Buffer.from('{"type":"resize","cols":132,"rows":50}'));
		expect(stream.setWindow).toHaveBeenCalledWith(50, 132, 0, 0);

		stream.emit("data", Buffer.from("load average: 0.1"));
		stream.stderr.emit("data", Buffer.from("warning"));
		expect(socket.text).toContain("load average: 0.1");
		expect(socket.text).toContain("warning");
	});

	it("closes the PTY channel and releases the lease when the socket closes", async () => {
		await open();
		socket.emit("close");
		expect(hoisted.channelCloseMock).toHaveBeenCalled();
		expect(hoisted.releaseMock).toHaveBeenCalledTimes(1);
	});

	it("releases the lease exactly once when the remote shell exits first", async () => {
		await open();
		stream.emit("close");
		socket.emit("close");
		expect(hoisted.releaseMock).toHaveBeenCalledTimes(1);
	});

	it("closes an idle session after 30 minutes and keeps it open while typing", async () => {
		await open();
		vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000);
		socket.emit("message", Buffer.from('{"type":"stdin","data":"a"}'));
		vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000);
		expect(socket.closes).toHaveLength(0);

		vi.advanceTimersByTime(2_000);
		expect(socket.text).toMatch(/30 minutes of inactivity/);
		expect(socket.closes.at(-1)).toEqual({ code: 1000, reason: "Idle timeout" });
		expect(hoisted.releaseMock).toHaveBeenCalledTimes(1);
	});

	it("surfaces a refused SSH handshake from the pool", async () => {
		hoisted.acquireMock.mockRejectedValue(
			new Error("All configured authentication methods failed"),
		);
		await open();
		expect(socket.errorMessage).toMatch(/authentication methods failed/);
	});

	it("surfaces a server with no SSH key (the pool refuses to lease one)", async () => {
		hoisted.acquireMock.mockRejectedValue(new Error("Server edge-1 has no SSH key attached"));
		await open();
		expect(socket.errorMessage).toMatch(/no SSH key/);
		expect(hoisted.shellMock).not.toHaveBeenCalled();
	});

	it("tells the socket when the shared connection dies under the session", async () => {
		await open();
		expect(hoisted.connectionLostHandlers).toHaveLength(1);
		hoisted.connectionLostHandlers[0]?.(new Error("socket hang up"));
		expect(socket.errorMessage).toMatch(/SSH connection lost: socket hang up/);
	});
});
