import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const mocked = vi.hoisted(() => ({
	resolveLocalContainer: vi.fn(),
	resolveLocalContainerById: vi.fn(),
	resolveRemoteContainerId: vi.fn(),
	acquireServerSsh: vi.fn(),
	assertWsTerminalAccess: vi.fn(async () => {}),
	assertWsDockerContainerAccess: vi.fn(async () => {}),
	execAsyncRemote: vi.fn(async (_serverId: string, _command: string, _options: unknown) => ({
		stdout: "",
		stderr: "",
	})),
}));

vi.mock("node:crypto", async (original) => ({
	...(await original<typeof import("node:crypto")>()),
	randomUUID: () => "terminal-lifecycle-test",
}));
vi.mock("../utils/exec", () => ({ execAsyncRemote: mocked.execAsyncRemote }));

vi.mock("./docker", () => ({
	...mocked,
	assertContainerNotProtected: vi.fn(async () => {}),
	SHELL_FALLBACK_COMMAND: "exec sh",
}));
vi.mock("./access", () => ({
	assertWsTerminalAccess: mocked.assertWsTerminalAccess,
	assertWsDockerContainerAccess: mocked.assertWsDockerContainerAccess,
	resolveWsOrganizationId: vi.fn(async () => "org-1"),
}));
vi.mock("../modules/compose/containers", () => ({
	assertComposeContainerOwnership: vi.fn(async () => {}),
}));
vi.mock("../modules/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("../modules/projects", () => ({ hasCapability: vi.fn(async () => true) }));
vi.mock("../modules/auth/instance-admin", () => ({
	assertInstanceAdmin: vi.fn(async () => {}),
}));
vi.mock("../modules/cluster/servers", () => ({
	findServerById: vi.fn(async () => ({ serverId: "server-1", name: "owned-server" })),
}));

import type { WsSession } from "./auth";
import { handleDockerTerminal } from "./docker-terminal";
import { handleServerTerminal } from "./server-terminal";
import { drainTerminalExecs } from "./terminal-exec";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

class FakeSocket extends EventEmitter {
	readyState = 1;
	OPEN = 1;
	bufferedAmount = 0;
	sent: Array<string | Buffer> = [];
	send(data: string | Buffer) {
		this.sent.push(data);
		this.emit("sent", data);
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

function channel() {
	const stream = Object.assign(new EventEmitter(), {
		active: true,
		stderr: new EventEmitter(),
		write: vi.fn(),
		setWindow: vi.fn(),
		end: vi.fn(),
		close: vi.fn(),
		destroy: vi.fn(),
	});
	stream.close.mockImplementation(() => {
		stream.active = false;
	});
	stream.destroy.mockImplementation(() => {
		stream.active = false;
	});
	return stream;
}

const session = {
	user: { id: "user-1", email: "operator@example.test", role: "admin" },
	session: { activeOrganizationId: "org-1" },
} as WsSession;
const request = (url: string) => ({ url, headers: { host: "panel.test" } }) as IncomingMessage;
const socket = (ws: FakeSocket) => ws as unknown as WebSocket;
const dockerRequest = request("/ws/terminal?appName=owned-app");
const remoteRequest = request("/ws/terminal?appName=owned-app&serverId=server-1");
const hostRequest = request("/ws/server-terminal?serverId=server-1");
const startupMarker = Buffer.from("\x1eNIXPLOY:terminal-lifecycle-test:42:98765\x1f");

function localExec(start: ReturnType<typeof vi.fn>, resize = vi.fn(async () => {})) {
	const cleanupStart = vi.fn(async () => {});
	const create = vi.fn(async (options: { AttachStdin?: boolean }) =>
		options.AttachStdin === false ? { start: cleanupStart } : { start, resize },
	);
	return { exec: create, cleanupStart };
}

function assertRemoteCleanup() {
	expect(mocked.execAsyncRemote).toHaveBeenCalledTimes(2);
	for (const [index, signal] of ["HUP", "KILL"].entries()) {
		const [serverId, command, options] = mocked.execAsyncRemote.mock.calls[index] ?? [];
		expect(serverId).toBe("server-1");
		expect(command).toContain("a".repeat(64));
		expect(command).toContain("nixploy-terminal-close");
		expect(command).toContain("42");
		expect(command).toContain("98765");
		expect(command).toContain(signal);
		expect(command).not.toContain("owned-app");
		expect(options).toEqual({ timeoutMs: 2_000 });
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocked.resolveRemoteContainerId.mockResolvedValue("a".repeat(64));
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("terminal startup cancellation", () => {
	it("does not start an exec created after browser cancellation", async () => {
		const ws = new FakeSocket();
		const created = deferred<{ start: ReturnType<typeof vi.fn> }>();
		const create = vi.fn(() => created.promise);
		const start = vi.fn();
		mocked.resolveLocalContainer.mockResolvedValue({ exec: create });
		const opening = handleDockerTerminal(socket(ws), dockerRequest, session);
		await vi.waitFor(() => expect(create).toHaveBeenCalled());
		ws.close();
		created.resolve({ start });
		await opening;
		expect(start).not.toHaveBeenCalled();
		expect(ws.sent).toEqual([]);
	});

	it("does not start a local shell when the socket closed during container lookup", async () => {
		const ws = new FakeSocket();
		const lookup = deferred<{ exec: ReturnType<typeof vi.fn> }>();
		const stream = channel();
		const exec = vi.fn(async () => ({ start: vi.fn(async () => stream) }));
		mocked.resolveLocalContainer.mockReturnValue(lookup.promise);
		const opening = handleDockerTerminal(socket(ws), dockerRequest, session);
		await vi.waitFor(() => expect(mocked.resolveLocalContainer).toHaveBeenCalled());
		ws.close();
		lookup.resolve({ exec });
		await opening;
		expect(exec).not.toHaveBeenCalled();
	});

	it("destroys a local PTY that arrives after the socket closed", async () => {
		const ws = new FakeSocket();
		const start = deferred<ReturnType<typeof channel>>();
		const stream = channel();
		const startExec = vi.fn(() => start.promise);
		const container = localExec(startExec);
		mocked.resolveLocalContainer.mockResolvedValue(container);
		const opening = handleDockerTerminal(socket(ws), dockerRequest, session);
		await vi.waitFor(() => expect(startExec).toHaveBeenCalled());
		ws.close();
		start.resolve(stream);
		await opening;
		// Keep reading until the private identity arrives, even after browser close.
		expect(stream.active).toBe(true);
		stream.emit("data", startupMarker);
		await vi.advanceTimersByTimeAsync(150);
		expect(stream.active).toBe(false);
		expect(ws.sent).toEqual([]);
		expect(container.cleanupStart).toHaveBeenCalledTimes(2);
		expect(container.exec.mock.calls.slice(1)).toEqual([
			[expect.objectContaining({ Cmd: expect.arrayContaining(["42", "98765", "HUP"]) })],
			[expect.objectContaining({ Cmd: expect.arrayContaining(["42", "98765", "KILL"]) })],
		]);
		expect(() => stream.emit("error", new Error("late stream failure"))).not.toThrow();
	});

	it("releases a remote lease acquired after the socket closed without starting a shell", async () => {
		const ws = new FakeSocket();
		const acquire = deferred<{
			client: { exec: ReturnType<typeof vi.fn> };
			release: ReturnType<typeof vi.fn>;
			onConnectionLost: ReturnType<typeof vi.fn>;
		}>();
		const exec = vi.fn();
		const release = vi.fn();
		mocked.acquireServerSsh.mockReturnValue(acquire.promise);
		const opening = handleDockerTerminal(socket(ws), remoteRequest, session);
		await vi.waitFor(() => expect(mocked.acquireServerSsh).toHaveBeenCalled());
		ws.close();
		acquire.resolve({ client: { exec }, release, onConnectionLost: vi.fn() });
		await opening;
		expect(release).toHaveBeenCalledTimes(1);
		expect(exec).not.toHaveBeenCalled();
	});

	it("closes a remote PTY returned after browser cancellation", async () => {
		const ws = new FakeSocket();
		const stream = channel();
		let attached!: (error: Error | null, value: typeof stream) => void;
		const release = vi.fn();
		mocked.acquireServerSsh.mockResolvedValue({
			client: {
				exec: vi.fn((_command: string, _options: unknown, callback: typeof attached) => {
					attached = callback;
				}),
			},
			release,
			onConnectionLost: vi.fn(),
		});
		await handleDockerTerminal(socket(ws), remoteRequest, session);
		ws.close();
		attached(null, stream);
		expect(stream.active).toBe(true);
		stream.emit("data", startupMarker);
		await vi.advanceTimersByTimeAsync(150);
		expect(stream.active).toBe(false);
		expect(release).toHaveBeenCalledTimes(1);
		expect(stream.close).toHaveBeenCalledTimes(1);
		assertRemoteCleanup();
		expect(mocked.resolveRemoteContainerId).toHaveBeenCalledTimes(1);
	});

	it("does not start a remote exec after cancellation during container lookup", async () => {
		const ws = new FakeSocket();
		const lookup = deferred<string>();
		const exec = vi.fn();
		const release = vi.fn();
		mocked.resolveRemoteContainerId.mockReturnValue(lookup.promise);
		mocked.acquireServerSsh.mockResolvedValue({
			client: { exec },
			release,
			onConnectionLost: vi.fn(),
		});
		const opening = handleDockerTerminal(socket(ws), remoteRequest, session);
		await vi.waitFor(() => expect(mocked.resolveRemoteContainerId).toHaveBeenCalled());
		ws.close();
		lookup.resolve("a".repeat(64));
		await opening;
		expect(exec).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledTimes(1);
		expect(ws.sent).toEqual([]);
	});

	it("releases a host-shell lease acquired after browser cancellation", async () => {
		vi.useFakeTimers();
		const ws = new FakeSocket();
		const acquire = deferred<{
			client: { shell: ReturnType<typeof vi.fn> };
			release: ReturnType<typeof vi.fn>;
			onConnectionLost: ReturnType<typeof vi.fn>;
		}>();
		const shell = vi.fn();
		const release = vi.fn();
		mocked.acquireServerSsh.mockReturnValue(acquire.promise);
		const opening = handleServerTerminal(socket(ws), hostRequest, session);
		await vi.waitFor(() => expect(mocked.acquireServerSsh).toHaveBeenCalled());
		ws.close();
		acquire.resolve({ client: { shell }, release, onConnectionLost: vi.fn() });
		await opening;
		expect(release).toHaveBeenCalledTimes(1);
		expect(shell).not.toHaveBeenCalled();
	});

	it("closes a host PTY returned after browser cancellation", async () => {
		vi.useFakeTimers();
		const ws = new FakeSocket();
		const stream = channel();
		let attached!: (error: Error | null, value: typeof stream) => void;
		const release = vi.fn();
		mocked.acquireServerSsh.mockResolvedValue({
			client: {
				shell: vi.fn((_options: unknown, callback: typeof attached) => {
					attached = callback;
				}),
			},
			release,
			onConnectionLost: vi.fn(),
		});
		await handleServerTerminal(socket(ws), hostRequest, session);
		ws.close();
		attached(null, stream);
		expect(stream.active).toBe(false);
		expect(release).toHaveBeenCalledTimes(1);
	});
});

describe("terminal attachment readiness", () => {
	it.each(["container", "host"] as const)(
		"drains a late remote %s callback before reporting terminal shutdown complete",
		async (kind) => {
			const ws = new FakeSocket();
			const stream = channel();
			let attached!: (error: Error | null, value: typeof stream) => void;
			const release = vi.fn();
			mocked.acquireServerSsh.mockResolvedValue({
				client: {
					exec: vi.fn((_command, _options, callback) => {
						attached = callback;
					}),
					shell: vi.fn((_options, callback) => {
						attached = callback;
					}),
				},
				release,
				onConnectionLost: vi.fn(),
			});
			await (kind === "container"
				? handleDockerTerminal(socket(ws), remoteRequest, session)
				: handleServerTerminal(socket(ws), hostRequest, session));
			ws.close();
			let finished = false;
			const draining = drainTerminalExecs().then((result) => {
				finished = true;
				return result;
			});
			await vi.advanceTimersByTimeAsync(1_200);
			expect(finished).toBe(false);
			attached(null, stream);
			if (kind === "container") stream.emit("data", startupMarker);
			await vi.advanceTimersByTimeAsync(150);
			expect(await draining).toEqual({
				timedOut: false,
				pendingExecutions: 0,
				pendingAttachments: 0,
				failed: 0,
			});
			expect(stream.active).toBe(false);
			expect(release).toHaveBeenCalledTimes(1);
			expect(ws.sent).toEqual([]);
		},
	);

	it("announces local readiness only after input and cleanup are wired", async () => {
		const ws = new FakeSocket();
		const start = deferred<ReturnType<typeof channel>>();
		const stream = channel();
		const resize = vi.fn(async () => {});
		const startExec = vi.fn(() => start.promise);
		const container = localExec(startExec, resize);
		mocked.resolveLocalContainer.mockResolvedValue(container);
		const opening = handleDockerTerminal(socket(ws), dockerRequest, session);
		await vi.waitFor(() => expect(startExec).toHaveBeenCalled());
		expect(ws.sent).toEqual([]);
		ws.on("sent", (data) => {
			if (data !== '{"type":"ready"}') return;
			ws.emit("message", Buffer.from('{"type":"resize","cols":132,"rows":50}'));
			ws.emit("message", Buffer.from('{"type":"stdin","data":"pwd\\n"}'));
			ws.close();
		});
		start.resolve(stream);
		await opening;
		expect(ws.sent).toEqual([]);
		stream.emit("data", startupMarker);
		await vi.advanceTimersByTimeAsync(150);
		expect(resize).toHaveBeenCalledWith({ w: 132, h: 50 });
		expect(stream.write).toHaveBeenCalledWith("pwd\n");
		expect(stream.active).toBe(false);
		expect(container.cleanupStart).toHaveBeenCalledTimes(2);
		expect(ws.sent).toEqual(['{"type":"ready"}']);
	});

	it.each(["container", "host"] as const)(
		"announces remote %s readiness only after handlers are wired and tears down once",
		async (kind) => {
			const ws = new FakeSocket();
			const stream = channel();
			let attached!: (error: Error | null, value: typeof stream) => void;
			const release = vi.fn();
			mocked.acquireServerSsh.mockResolvedValue({
				client: {
					exec: vi.fn((_command: string, _options: unknown, callback: typeof attached) => {
						attached = callback;
					}),
					shell: vi.fn((_options: unknown, callback: typeof attached) => {
						attached = callback;
					}),
				},
				release,
				onConnectionLost: vi.fn(),
			});
			await (kind === "container"
				? handleDockerTerminal(socket(ws), remoteRequest, session)
				: handleServerTerminal(socket(ws), hostRequest, session));
			expect(ws.sent).toEqual([]);
			ws.on("sent", (data) => {
				if (data !== '{"type":"ready"}') return;
				ws.emit("message", Buffer.from('{"type":"resize","cols":132,"rows":50}'));
				ws.emit("message", Buffer.from('{"type":"stdin","data":"pwd\\n"}'));
				ws.close();
			});
			attached(null, stream);
			if (kind === "container") {
				expect(ws.sent).toEqual([]);
				stream.emit("data", startupMarker);
				await vi.advanceTimersByTimeAsync(150);
				assertRemoteCleanup();
			}
			expect(stream.setWindow).toHaveBeenCalledWith(50, 132, 0, 0);
			expect(stream.write).toHaveBeenCalledWith("pwd\n");
			expect(stream.active).toBe(false);
			expect(stream.close).toHaveBeenCalledTimes(1);
			stream.emit("close");
			expect(release).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["container", "host"] as const)(
		"closes an attached remote %s shell when its pooled transport fails",
		async (kind) => {
			const ws = new FakeSocket();
			const stream = channel();
			let lost!: (error: Error) => void;
			const release = vi.fn();
			mocked.acquireServerSsh.mockResolvedValue({
				client: {
					exec: vi.fn((_command, _options, callback) => callback(null, stream)),
					shell: vi.fn((_options, callback) => callback(null, stream)),
				},
				release,
				onConnectionLost: (callback: typeof lost) => {
					lost = callback;
				},
			});
			await (kind === "container"
				? handleDockerTerminal(socket(ws), remoteRequest, session)
				: handleServerTerminal(socket(ws), hostRequest, session));
			if (kind === "container") stream.emit("data", startupMarker);
			lost(new Error("transport disconnected"));
			await vi.advanceTimersByTimeAsync(150);
			expect(ws.readyState).toBe(3);
			expect(stream.active).toBe(false);
			expect(release).toHaveBeenCalledTimes(1);
			expect(ws.sent).toContain(
				JSON.stringify({ type: "error", message: "SSH connection lost: transport disconnected" }),
			);
			stream.emit("close");
			stream.emit("error", new Error("late channel failure"));
			expect(release).toHaveBeenCalledTimes(1);
			if (kind === "container") assertRemoteCleanup();
		},
	);
});
