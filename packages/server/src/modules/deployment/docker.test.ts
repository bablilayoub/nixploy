import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The remote transport is faked at the ssh2 boundary: `exec()` hands back a
 * real TCP socket connected to a local HTTP server standing in for
 * `docker system dial-stdio`. That exercises the whole pooled-agent path —
 * dockerode → docker-modem → our `http.Agent` → the pool — offline.
 */
const sshFake = vi.hoisted(() => ({
	port: 0,
	commands: [] as string[],
	clients: 0,
}));

vi.mock("ssh2", async () => {
	const { EventEmitter } = await import("node:events");
	const net = await import("node:net");
	class Client extends EventEmitter {
		connect() {
			sshFake.clients += 1;
			queueMicrotask(() => this.emit("ready"));
			return this;
		}
		exec(command: string, callback: (error: Error | null, channel?: unknown) => void) {
			sshFake.commands.push(command);
			const socket = net.connect(sshFake.port, "127.0.0.1");
			socket.once("connect", () => callback(null, socket));
			socket.once("error", (error: Error) => callback(error));
			return true;
		}
		end() {
			this.emit("close");
		}
		destroy() {
			this.emit("close");
		}
	}
	return { Client };
});

vi.mock("../../db", () => ({
	db: {
		query: {
			servers: {
				findFirst: async () => ({
					serverId: "srv-1",
					name: "prod-1",
					ipAddress: "10.0.0.9",
					port: 22,
					username: "root",
					sshKey: { privateKey: "KEY" },
				}),
			},
		},
	},
}));

import { closeAllSshConnections, getServerTransportState } from "../../utils/ssh-pool";
import { forgetRemoteDocker, getDocker, spawnTargeted } from "./docker";

describe("spawnLocal cancellation", () => {
	it("rejects done as cancelled when killed", async () => {
		const proc = await spawnTargeted(null, "sleep 60");
		proc.kill();
		await expect(proc.done).rejects.toMatchObject({ killed: true });
	});

	it("kills the whole process group, not just the sh wrapper", async () => {
		// The sleep child lives in the shell's process group; killing only the
		// `sh -c` wrapper (the old behavior) would leave it running.
		const proc = await spawnTargeted(null, "sleep 60 & wait");
		const pid = proc.pid;
		expect(pid).toBeTypeOf("number");
		proc.kill();
		await expect(proc.done).rejects.toMatchObject({ killed: true });

		// Give the kernel a beat to reap the group, then probe it.
		await new Promise((resolve) => setTimeout(resolve, 200));
		let groupAlive = true;
		try {
			if (pid) process.kill(-pid, 0);
		} catch {
			groupAlive = false; // ESRCH — the whole group is gone
		}
		expect(groupAlive).toBe(false);
	});

	it("resolves done on exit 0", async () => {
		const proc = await spawnTargeted(null, "true");
		await expect(proc.done).resolves.toBeUndefined();
	});

	it("rejects done on non-zero exit", async () => {
		const proc = await spawnTargeted(null, "exit 3");
		await expect(proc.done).rejects.toMatchObject({ exitCode: 3, killed: false });
	});
});

describe("spawnLocal timeout", () => {
	it("kills the whole tree and rejects as a failure (not a cancellation) when the timeout expires", async () => {
		const startedAt = Date.now();
		const proc = await spawnTargeted(null, "sleep 60 & wait", { timeoutMs: 100 });
		const pid = proc.pid;
		await expect(proc.done).rejects.toMatchObject({
			killed: false,
			message: expect.stringMatching(/^Command timed out after 0s/),
		});
		// A hung build must not wait for the child to exit on its own.
		expect(Date.now() - startedAt).toBeLessThan(5_000);

		await new Promise((resolve) => setTimeout(resolve, 200));
		let groupAlive = true;
		try {
			if (pid) process.kill(-pid, 0);
		} catch {
			groupAlive = false;
		}
		expect(groupAlive).toBe(false);
	});

	it("does not fire for commands that finish in time", async () => {
		const proc = await spawnTargeted(null, "true", { timeoutMs: 5_000 });
		await expect(proc.done).resolves.toBeUndefined();
	});
});

describe("getDocker", () => {
	it("talks to the local socket when no server is given", async () => {
		const docker = await getDocker(null);
		const modem = docker.modem as { socketPath?: unknown; protocol?: string; agent?: unknown };
		expect(modem.socketPath).toBeDefined();
		expect(modem.agent).toBeUndefined();
	});

	it("tunnels a managed server over the pooled SSH agent, not docker-modem's own client", async () => {
		const docker = await getDocker("srv-pool-1");
		const modem = docker.modem as { protocol?: string; agent?: { createConnection?: unknown } };
		// docker-modem's `protocol: "ssh"` branch builds a fresh ssh2 Client per
		// API call; ours hands it an agent backed by `utils/ssh-pool`.
		expect(modem.protocol).not.toBe("ssh");
		expect(typeof modem.agent?.createConnection).toBe("function");

		// Cached: the agent (and the pooled connection behind it) is reused.
		expect(await getDocker("srv-pool-1")).toBe(docker);
		forgetRemoteDocker("srv-pool-1");
		expect(await getDocker("srv-pool-1")).not.toBe(docker);
		forgetRemoteDocker("srv-pool-1");
	});
});

describe("dockerode over the pooled SSH transport", () => {
	let server: http.Server;
	const requests: string[] = [];

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			requests.push(req.url ?? "");
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("OK");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		sshFake.port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		closeAllSshConnections();
		forgetRemoteDocker("srv-1");
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("talks the engine API over `docker system dial-stdio` and reuses one connection", async () => {
		sshFake.commands.length = 0;
		sshFake.clients = 0;
		requests.length = 0;

		const docker = await getDocker("srv-1");
		expect(String(await docker.ping()).trim()).toBe("OK");
		expect(String(await docker.ping()).trim()).toBe("OK");

		// Two API calls, two channels — but a single SSH handshake.
		expect(requests).toHaveLength(2);
		expect(sshFake.commands).toEqual(["docker system dial-stdio", "docker system dial-stdio"]);
		expect(sshFake.clients).toBe(1);

		// Channels (and their pool slots) are given back on the socket's `close`,
		// which lands a tick after the HTTP response completes.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
		expect(getServerTransportState("srv-1").connected).toBe(true);
	});
});

describe("CommandError", () => {
	it("is a DomainError so the boundary keeps its message and code", async () => {
		const { CommandError } = await import("./docker");
		const { isDomainError } = await import("../errors");

		const failed = new CommandError("Command failed (exit 1)", 1, false);
		expect(isDomainError(failed)).toBe(true);
		expect(failed.code).toBe("INTERNAL_SERVER_ERROR");
		expect(failed.exitCode).toBe(1);
		expect(failed.killed).toBe(false);
		expect(failed).toBeInstanceOf(CommandError);
		expect(failed.name).toBe("CommandError");

		// A timeout is a TIMEOUT, not a bug — REST returns 408, MCP says TIMEOUT.
		const timedOut = new CommandError("Command timed out after 30m", null, false, "TIMEOUT");
		expect(timedOut.code).toBe("TIMEOUT");

		// `killed` still tells a user cancel from a real failure (worker.ts, hooks.ts).
		const cancelled = new CommandError("Command was cancelled", null, true);
		expect(cancelled.killed).toBe(true);
	});
});
