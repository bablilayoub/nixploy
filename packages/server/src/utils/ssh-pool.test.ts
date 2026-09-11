import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pool is driven entirely through a fake ssh2 `Client`: no sockets, no
 * managed server, no network. Everything the real transport does that matters
 * here — handshake, channel budget, keepalive options, idle close, reconnect
 * after an error, circuit breaker — is observable from the fake.
 */

/** Structural view of the fake client, without dragging EventEmitter's type in. */
type FakeClient = {
	config: Record<string, unknown> | null;
	ended: boolean;
	destroyed: boolean;
	emit(event: string, ...args: unknown[]): boolean;
};

const hoisted = vi.hoisted(() => ({
	clients: [] as unknown[],
	connect: { fail: false, error: new Error("connect ECONNREFUSED 10.0.0.9:22") },
	row: {
		serverId: "srv-1",
		name: "prod-1",
		ipAddress: "10.0.0.9",
		port: 2222,
		username: "deploy",
		sshKey: { privateKey: "PRIVATE-KEY-MATERIAL" },
	} as Record<string, unknown> | undefined,
}));

vi.mock("ssh2", async () => {
	const { EventEmitter } = await import("node:events");
	class Client extends EventEmitter {
		config: Record<string, unknown> | null = null;
		ended = false;
		destroyed = false;
		openChannels = 0;

		connect(config: Record<string, unknown>) {
			this.config = config;
			hoisted.clients.push(this);
			queueMicrotask(() => {
				if (hoisted.connect.fail) this.emit("error", hoisted.connect.error);
				else this.emit("ready");
			});
			return this;
		}

		exec(_command: string, callback: (error: Error | null, channel?: unknown) => void) {
			this.openChannels += 1;
			const channel = Object.assign(new EventEmitter(), {
				stderr: new EventEmitter(),
				close: () => channel.emit("close", 0),
				write: () => {},
				end: () => {},
				resume: () => {},
			});
			channel.once("close", () => {
				this.openChannels -= 1;
			});
			queueMicrotask(() => callback(null, channel));
			return true;
		}

		end() {
			if (this.ended) return;
			this.ended = true;
			this.emit("close");
		}

		destroy() {
			if (this.destroyed) return;
			this.destroyed = true;
			this.emit("close");
		}
	}
	return { Client };
});

vi.mock("../db", () => ({
	db: { query: { servers: { findFirst: async () => hoisted.row } } },
}));

import {
	acquireSsh,
	closeAllSshConnections,
	DEFAULT_SSH_MAX_CHANNELS,
	getServerTransportState,
	invalidateServerTransport,
	isServerUnreachable,
	resetServerTransport,
	sshPoolLimits,
} from "./ssh-pool";

const ENV_KEYS = [
	"NIXPLOY_SSH_MAX_CHANNELS",
	"NIXPLOY_SSH_IDLE_MS",
	"NIXPLOY_SSH_BREAKER_MS",
	"NIXPLOY_SSH_BREAKER_FAILURES",
	"NIXPLOY_SSH_CONNECT_TIMEOUT_MS",
	"NIXPLOY_CONFIG_DIR",
] as const;

let configDir: string;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

const clients = () => hoisted.clients as FakeClient[];
const latestClient = () => clients()[clients().length - 1] as FakeClient;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	configDir = await mkdtemp(join(tmpdir(), "nixploy-ssh-pool-"));
	process.env.NIXPLOY_CONFIG_DIR = configDir;
	hoisted.clients.length = 0;
	hoisted.connect.fail = false;
	hoisted.row = {
		serverId: "srv-1",
		name: "prod-1",
		ipAddress: "10.0.0.9",
		port: 2222,
		username: "deploy",
		sshKey: { privateKey: "PRIVATE-KEY-MATERIAL" },
	};
});

afterEach(async () => {
	closeAllSshConnections();
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	await rm(configDir, { recursive: true, force: true });
});

describe("connection reuse", () => {
	it("dials once and reuses the connection across commands", async () => {
		for (let i = 0; i < 4; i += 1) {
			const lease = await acquireSsh("srv-1");
			expect(lease.server.name).toBe("prod-1");
			lease.release();
		}
		expect(clients()).toHaveLength(1);
	});

	it("coalesces concurrent first-use into a single handshake", async () => {
		const leases = await Promise.all([
			acquireSsh("srv-1"),
			acquireSsh("srv-1"),
			acquireSsh("srv-1"),
		]);
		expect(clients()).toHaveLength(1);
		for (const lease of leases) lease.release();
	});

	it("passes keepalive, connect timeout and the host-key pin to ssh2", async () => {
		process.env.NIXPLOY_SSH_CONNECT_TIMEOUT_MS = "5000";
		const lease = await acquireSsh("srv-1");
		const config = latestClient().config as Record<string, unknown>;
		expect(config.host).toBe("10.0.0.9");
		expect(config.port).toBe(2222);
		expect(config.username).toBe("deploy");
		expect(config.privateKey).toBe("PRIVATE-KEY-MATERIAL");
		expect(config.readyTimeout).toBe(5_000);
		expect(config.keepaliveInterval).toBeGreaterThan(0);
		expect(config.keepaliveCountMax).toBeGreaterThan(0);
		// Trust-on-first-use pinning still runs on every dial.
		const verify = config.hostVerifier as (key: Buffer) => boolean;
		expect(verify(Buffer.from("host-key"))).toBe(true);
		expect(verify(Buffer.from("different-key"))).toBe(false);
		lease.release();
	});
});

describe("channel budget", () => {
	it("defaults below the usual sshd MaxSessions", () => {
		expect(DEFAULT_SSH_MAX_CHANNELS).toBe(8);
		expect(sshPoolLimits().maxChannels).toBe(8);
	});

	it("queues callers once every channel is taken and serves them FIFO", async () => {
		process.env.NIXPLOY_SSH_MAX_CHANNELS = "2";
		const first = await acquireSsh("srv-1");
		const second = await acquireSsh("srv-1");
		expect(getServerTransportState("srv-1").openChannels).toBe(2);

		const order: string[] = [];
		const third = acquireSsh("srv-1").then((lease) => {
			order.push("third");
			return lease;
		});
		const fourth = acquireSsh("srv-1").then((lease) => {
			order.push("fourth");
			return lease;
		});
		await settle();
		expect(order).toEqual([]);
		// No second connection was opened to get around the limit.
		expect(clients()).toHaveLength(1);

		first.release();
		second.release();
		const [thirdLease, fourthLease] = await Promise.all([third, fourth]);
		expect(order).toEqual(["third", "fourth"]);
		expect(clients()).toHaveLength(1);
		thirdLease.release();
		fourthLease.release();
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
	});

	it("releases a slot only once, however often release is called", async () => {
		process.env.NIXPLOY_SSH_MAX_CHANNELS = "1";
		const lease = await acquireSsh("srv-1");
		lease.release();
		lease.release();
		lease.release();
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
	});
});

describe("idle close", () => {
	it("closes the connection after the idle window and reconnects on demand", async () => {
		process.env.NIXPLOY_SSH_IDLE_MS = "1000";
		const lease = await acquireSsh("srv-1");
		lease.release();
		expect(getServerTransportState("srv-1").connected).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(getServerTransportState("srv-1").connected).toBe(true);

		// Shrink the window and bounce a lease so the timer is re-armed short.
		process.env.NIXPLOY_SSH_IDLE_MS = "20";
		const again = await acquireSsh("srv-1");
		again.release();
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(getServerTransportState("srv-1").connected).toBe(false);
		expect(clients()[0]?.ended || clients()[0]?.destroyed).toBe(true);

		const next = await acquireSsh("srv-1");
		expect(clients()).toHaveLength(2);
		next.release();
	});

	it("keeps a busy connection open", async () => {
		process.env.NIXPLOY_SSH_IDLE_MS = "20";
		const held = await acquireSsh("srv-1");
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(getServerTransportState("srv-1").connected).toBe(true);
		held.release();
	});
});

describe("reconnect", () => {
	it("drops the connection on a transport error and dials a new one", async () => {
		const lease = await acquireSsh("srv-1");
		const lost: Error[] = [];
		lease.onConnectionLost((error) => lost.push(error));

		latestClient().emit("error", new Error("keepalive timeout"));
		await settle();

		expect(lost.map((error) => error.message)).toEqual(["keepalive timeout"]);
		expect(getServerTransportState("srv-1").connected).toBe(false);
		// The dead connection's slot is given back, not leaked.
		expect(getServerTransportState("srv-1").openChannels).toBe(0);

		const next = await acquireSsh("srv-1");
		expect(clients()).toHaveLength(2);
		next.release();
		// One transport failure recorded, then cleared by the successful dial.
		expect(getServerTransportState("srv-1").consecutiveFailures).toBe(0);
	});

	it("discard tears the shared connection down and counts as a failure", async () => {
		const lease = await acquireSsh("srv-1");
		lease.discard(new Error("channel refused"));
		await settle();
		expect(getServerTransportState("srv-1").connected).toBe(false);
		expect(getServerTransportState("srv-1").consecutiveFailures).toBe(1);
		expect(getServerTransportState("srv-1").lastError).toBe("channel refused");
	});

	it("forgets cached credentials when the server row changes", async () => {
		const lease = await acquireSsh("srv-1");
		lease.release();
		hoisted.row = {
			serverId: "srv-1",
			name: "prod-1",
			ipAddress: "10.0.0.42",
			port: 22,
			username: "root",
			sshKey: { privateKey: "ROTATED" },
		};
		invalidateServerTransport("srv-1");
		const next = await acquireSsh("srv-1");
		expect((latestClient().config as Record<string, unknown>).host).toBe("10.0.0.42");
		expect((latestClient().config as Record<string, unknown>).privateKey).toBe("ROTATED");
		next.release();
	});
});

describe("circuit breaker", () => {
	beforeEach(() => {
		process.env.NIXPLOY_SSH_BREAKER_FAILURES = "3";
		process.env.NIXPLOY_SSH_BREAKER_MS = "60000";
	});

	it("opens after N consecutive connect failures and short-circuits the next command", async () => {
		hoisted.connect.fail = true;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			await expect(acquireSsh("srv-1")).rejects.toThrow(/ECONNREFUSED/);
			expect(getServerTransportState("srv-1").consecutiveFailures).toBe(attempt);
		}
		expect(clients()).toHaveLength(3);
		expect(isServerUnreachable("srv-1")).toBe(true);

		// The fourth call never touches the network.
		await expect(acquireSsh("srv-1")).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: expect.stringContaining('Server "prod-1" is unreachable over SSH'),
		});
		await expect(acquireSsh("srv-1")).rejects.toThrow(/Nixploy retries in/);
		expect(clients()).toHaveLength(3);

		const state = getServerTransportState("srv-1");
		expect(state.status).toBe("unreachable");
		expect(state.retryAt).toBeGreaterThan(Date.now());
		expect(state.lastError).toContain("ECONNREFUSED");
	});

	it("keeps the open breaker out of the user-facing message's detail", async () => {
		hoisted.connect.fail = true;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await acquireSsh("srv-1").catch(() => {});
		}
		const error = await acquireSsh("srv-1").catch((caught: Error) => caught);
		// stderr / addresses stay in getServerTransportState, not in the toast.
		expect((error as Error).message).not.toContain("10.0.0.9");
	});

	it("goes half-open once the window passes and closes on the next success", async () => {
		process.env.NIXPLOY_SSH_BREAKER_MS = "20";
		hoisted.connect.fail = true;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await acquireSsh("srv-1").catch(() => {});
		}
		expect(isServerUnreachable("srv-1")).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(isServerUnreachable("srv-1")).toBe(false);

		hoisted.connect.fail = false;
		const lease = await acquireSsh("srv-1");
		const state = getServerTransportState("srv-1");
		expect(state.status).toBe("ok");
		expect(state.consecutiveFailures).toBe(0);
		expect(state.lastError).toBeNull();
		expect(state.lastSeenAt).not.toBeNull();
		lease.release();
	});

	it("re-opens when the half-open probe fails again", async () => {
		process.env.NIXPLOY_SSH_BREAKER_MS = "20";
		hoisted.connect.fail = true;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await acquireSsh("srv-1").catch(() => {});
		}
		await new Promise((resolve) => setTimeout(resolve, 40));
		await expect(acquireSsh("srv-1")).rejects.toThrow(/ECONNREFUSED/);
		expect(isServerUnreachable("srv-1")).toBe(true);
		expect(getServerTransportState("srv-1").consecutiveFailures).toBe(4);
	});

	it("resetServerTransport closes the breaker for a manual retry", async () => {
		hoisted.connect.fail = true;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			await acquireSsh("srv-1").catch(() => {});
		}
		expect(isServerUnreachable("srv-1")).toBe(true);

		resetServerTransport("srv-1");
		expect(isServerUnreachable("srv-1")).toBe(false);
		expect(getServerTransportState("srv-1").consecutiveFailures).toBe(0);

		hoisted.connect.fail = false;
		const lease = await acquireSsh("srv-1");
		lease.release();
	});

	it("reports a clean state for a server nothing has talked to yet", () => {
		expect(getServerTransportState("srv-unknown")).toMatchObject({
			status: "ok",
			connected: false,
			openChannels: 0,
			consecutiveFailures: 0,
			retryAt: null,
		});
	});
});

describe("credentials", () => {
	it("rejects an unknown server with NOT_FOUND and never dials", async () => {
		hoisted.row = undefined;
		await expect(acquireSsh("srv-gone")).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Server not found: srv-gone",
		});
		expect(clients()).toHaveLength(0);
	});

	it("rejects a server without an SSH key and does not count it as a transport failure", async () => {
		hoisted.row = {
			serverId: "srv-1",
			name: "prod-1",
			ipAddress: "10.0.0.9",
			port: 22,
			username: "root",
			sshKey: null,
		};
		await expect(acquireSsh("srv-1")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(getServerTransportState("srv-1").consecutiveFailures).toBe(0);
		expect(clients()).toHaveLength(0);
	});
});
