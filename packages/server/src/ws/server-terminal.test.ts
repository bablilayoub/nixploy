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
	const connectMock = vi.fn();
	const shellMock = vi.fn();
	const endMock = vi.fn();

	/** Just enough of `EventEmitter` for ssh2's `ready` / `error` / stream events. */
	class TinyEmitter {
		private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
		on(event: string, listener: (...args: unknown[]) => void) {
			const existing = this.listeners.get(event) ?? [];
			existing.push(listener);
			this.listeners.set(event, existing);
			return this;
		}
		emit(event: string, ...args: unknown[]) {
			for (const listener of this.listeners.get(event) ?? []) listener(...args);
			return true;
		}
	}

	class FakeSshClient extends TinyEmitter {
		shell = shellMock;
		end = endMock;
		connect(options: unknown) {
			clients.push(this);
			connectMock(options);
			return this;
		}
	}

	/** Every client the module under test constructed, newest last. */
	const clients: FakeSshClient[] = [];

	return {
		FakeSshClient,
		clients,
		connectMock,
		shellMock,
		endMock,
		verifyRemoteHostKey: vi.fn(() => true),
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
		state: {
			serverRow: {
				serverId: "srv-1",
				name: "edge-1",
				ipAddress: "10.0.0.9",
				port: 22,
				username: "root",
				sshKey: { privateKey: "PRIVATE" } as { privateKey: string } | null,
			} as Record<string, unknown> | null,
		},
	};
});

vi.mock("ssh2", () => ({ Client: hoisted.FakeSshClient }));
vi.mock("../utils/exec", () => ({ verifyRemoteHostKey: hoisted.verifyRemoteHostKey }));
vi.mock("../modules/audit", () => ({ recordAudit: hoisted.recordAudit }));
vi.mock("./access", () => ({ resolveWsOrganizationId: hoisted.resolveWsOrganizationId }));
vi.mock("../modules/projects", () => ({ hasCapability: hoisted.hasCapability }));
vi.mock("../modules/auth/instance-admin", () => ({
	assertInstanceAdmin: hoisted.assertInstanceAdmin,
}));
vi.mock("../modules/cluster/servers", () => ({ findServerById: hoisted.findServerById }));
vi.mock("../db", () => ({
	db: { query: { servers: { findFirst: async () => hoisted.state.serverRow } } },
}));
vi.mock("../db/schema", () => ({ servers: { serverId: "server_id" } }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

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
	});
	hoisted.connectMock.mockReset();
	hoisted.endMock.mockReset();
	hoisted.recordAudit.mockReset();
	hoisted.hasCapability.mockResolvedValue(true);
	hoisted.assertInstanceAdmin.mockResolvedValue(undefined);
	hoisted.findServerById.mockResolvedValue({ serverId: "srv-1", name: "edge-1" });
	hoisted.state.serverRow = {
		serverId: "srv-1",
		name: "edge-1",
		ipAddress: "10.0.0.9",
		port: 22,
		username: "root",
		sshKey: { privateKey: "PRIVATE" },
	};
	hoisted.clients.length = 0;
	// The fake client resolves `shell` with our stream on the next tick.
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

/** Drive the handler and let the fake client reach `ready`. */
async function open(url = "/ws/server-terminal?serverId=srv-1"): Promise<void> {
	const pending = handleServerTerminal(
		socket as unknown as never,
		request(url),
		session(),
	) as Promise<void>;
	await pending;
	// `connect()` on the fake is synchronous; emit ready the way ssh2 would.
	hoisted.clients.at(-1)?.emit("ready");
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
		expect(hoisted.connectMock).not.toHaveBeenCalled();
	});

	it("closes without connecting when the caller lacks the capability", async () => {
		hoisted.hasCapability.mockResolvedValue(false);
		await open();
		expect(socket.errorMessage).toMatch(/servers\.manage/);
		expect(hoisted.connectMock).not.toHaveBeenCalled();
		expect(hoisted.recordAudit).not.toHaveBeenCalled();
	});

	it("pins the host key and audits the session before connecting", async () => {
		await open();
		expect(hoisted.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "server.terminal.open",
				targetId: "srv-1",
				targetName: "edge-1",
				actorId: "user-1",
			}),
		);
		const options = hoisted.connectMock.mock.calls[0]?.[0] as {
			host: string;
			username: string;
			privateKey: string;
			hostVerifier: (key: Buffer) => boolean;
		};
		expect(options.host).toBe("10.0.0.9");
		expect(options.username).toBe("root");
		expect(options.privateKey).toBe("PRIVATE");
		options.hostVerifier(Buffer.from("key"));
		expect(hoisted.verifyRemoteHostKey).toHaveBeenCalledWith("srv-1", Buffer.from("key"));
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

	it("ends the SSH connection when the socket closes", async () => {
		await open();
		socket.emit("close");
		expect(hoisted.endMock).toHaveBeenCalled();
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
		expect(hoisted.endMock).toHaveBeenCalled();
	});

	it("surfaces a refused SSH handshake", async () => {
		const pending = handleServerTerminal(
			socket as unknown as never,
			request("/ws/server-terminal?serverId=srv-1"),
			session(),
		) as Promise<void>;
		await pending;
		hoisted.clients
			.at(-1)
			?.emit("error", new Error("All configured authentication methods failed"));
		expect(socket.errorMessage).toMatch(/authentication methods failed/);
	});

	it("refuses a server row without an SSH key", async () => {
		hoisted.state.serverRow = {
			serverId: "srv-1",
			name: "edge-1",
			ipAddress: "10.0.0.9",
			port: 22,
			username: "root",
			sshKey: null,
		};
		await open();
		expect(socket.errorMessage).toMatch(/no SSH key/);
		expect(hoisted.connectMock).not.toHaveBeenCalled();
	});
});
