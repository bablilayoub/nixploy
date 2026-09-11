import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The remote helpers now run on a channel of the server's pooled SSH
 * connection (`utils/ssh-pool.ts`). A fake ssh2 client keeps their contract —
 * `RemoteExecError` with stderr and the exit code, the hard timeout — under
 * test without a managed server. The local-exec tests below are untouched by
 * these mocks.
 */
const remote = vi.hoisted(() => ({
	/** Every channel the fake client handed out this test. */
	channels: [] as Array<{
		command: string;
		stdin: string[];
		closed: boolean;
		finish(code: number, stdout?: string, stderr?: string): void;
	}>,
}));

vi.mock("ssh2", async () => {
	const { EventEmitter } = await import("node:events");
	class Client extends EventEmitter {
		connect() {
			queueMicrotask(() => this.emit("ready"));
			return this;
		}
		exec(command: string, callback: (error: Error | null, channel?: unknown) => void) {
			const stderr = new EventEmitter();
			const channel = Object.assign(new EventEmitter(), {
				stderr,
				stdin: [] as string[],
				closed: false,
				command,
				close: () => {
					channel.closed = true;
					channel.emit("close", null);
				},
				write: (chunk: string) => channel.stdin.push(String(chunk)),
				end: () => {},
				resume: () => {},
				finish: (code: number, stdout = "", errText = "") => {
					if (stdout) channel.emit("data", Buffer.from(stdout));
					if (errText) stderr.emit("data", Buffer.from(errText));
					channel.emit("close", code);
				},
			});
			remote.channels.push(channel);
			queueMicrotask(() => callback(null, channel));
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

vi.mock("../db", () => ({
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

import {
	clearRemoteHostKey,
	DEFAULT_COMMAND_TIMEOUT_MS,
	describeTimeout,
	execAsync,
	execAsyncRemote,
	execAsyncRemoteWithStdin,
	execAsyncWithStdin,
	getGitKnownHostsPath,
	getPinnedHostsDir,
	localCommandTimeoutMs,
	remoteCommandTimeoutMs,
	verifyRemoteHostKey,
} from "./exec";
import { closeAllSshConnections, getServerTransportState } from "./ssh-pool";

describe("managed-server host key pinning", () => {
	let configDir: string;
	let originalConfigDir: string | undefined;

	beforeEach(async () => {
		configDir = await mkdtemp(join(tmpdir(), "nixploy-exec-test-"));
		originalConfigDir = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = configDir;
	});

	afterEach(async () => {
		if (originalConfigDir === undefined) {
			delete process.env.NIXPLOY_CONFIG_DIR;
		} else {
			process.env.NIXPLOY_CONFIG_DIR = originalConfigDir;
		}
		await rm(configDir, { recursive: true, force: true });
	});

	it("pins on first use under ssh/pinned-hosts and rejects a changed key", () => {
		const key = Buffer.from("ssh-ed25519 key one");
		expect(verifyRemoteHostKey("srv-1", key)).toBe(true);
		expect(existsSync(join(getPinnedHostsDir(), "srv-1.pub"))).toBe(true);
		expect(verifyRemoteHostKey("srv-1", key)).toBe(true);
		expect(verifyRemoteHostKey("srv-1", Buffer.from("ssh-ed25519 other"))).toBe(false);

		clearRemoteHostKey("srv-1");
		expect(existsSync(join(getPinnedHostsDir(), "srv-1.pub"))).toBe(false);
	});

	it("honors and migrates pins from the legacy ssh/known_hosts directory", () => {
		const key = Buffer.from("ssh-ed25519 legacy");
		const legacyDir = join(configDir, "ssh", "known_hosts");
		mkdirSync(legacyDir, { recursive: true });
		writeFileSync(join(legacyDir, "srv-2.pub"), `${key.toString("base64")}\n`);

		expect(verifyRemoteHostKey("srv-2", Buffer.from("ssh-ed25519 impostor"))).toBe(false);
		expect(verifyRemoteHostKey("srv-2", key)).toBe(true);
		expect(existsSync(join(getPinnedHostsDir(), "srv-2.pub"))).toBe(true);

		clearRemoteHostKey("srv-2");
		expect(existsSync(join(legacyDir, "srv-2.pub"))).toBe(false);
	});

	it("keeps the git known_hosts file apart from the pin directory", () => {
		expect(getGitKnownHostsPath()).toBe(join(configDir, "ssh", "git_known_hosts"));
		expect(getPinnedHostsDir()).toBe(join(configDir, "ssh", "pinned-hosts"));
	});
});

describe("command timeouts", () => {
	const envKeys = ["NIXPLOY_COMMAND_TIMEOUT_MS", "NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS"] as const;
	const saved: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

	beforeEach(() => {
		for (const key of envKeys) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it("resolves local and remote timeouts from the environment with explicit overrides winning", () => {
		expect(localCommandTimeoutMs()).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
		expect(remoteCommandTimeoutMs()).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
		process.env.NIXPLOY_COMMAND_TIMEOUT_MS = "1234";
		expect(localCommandTimeoutMs()).toBe(1234);
		// The generic knob also covers SSH when the remote-specific one is unset.
		expect(remoteCommandTimeoutMs()).toBe(1234);
		process.env.NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS = "99";
		expect(remoteCommandTimeoutMs()).toBe(99);
		expect(localCommandTimeoutMs(5)).toBe(5);
		expect(remoteCommandTimeoutMs(7)).toBe(7);
		process.env.NIXPLOY_COMMAND_TIMEOUT_MS = "nope";
		expect(localCommandTimeoutMs()).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
	});

	it("describes timeouts in minutes or seconds", () => {
		expect(describeTimeout(30 * 60 * 1000)).toBe("30min");
		expect(describeTimeout(45_000)).toBe("45s");
		expect(describeTimeout(90_000)).toBe("90s");
	});

	it("execAsync kills the whole process tree and rejects when the timeout expires", async () => {
		const startedAt = Date.now();
		// `sleep 60 &` would keep the stdio pipes open after the shell dies —
		// without the group kill the promise would hang for a minute.
		await expect(execAsync("sleep 60 & wait", { timeout: 100 })).rejects.toMatchObject({
			name: "CommandTimeoutError",
			message: '"sleep" timed out after 0s',
		});
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it("execAsync still resolves for commands that finish in time", async () => {
		await expect(execAsync("printf ok", { timeout: 5_000 })).resolves.toBe("ok");
	});

	it("execAsyncWithStdin times out the same way", async () => {
		await expect(
			execAsyncWithStdin("cat >/dev/null; sleep 60 & wait", "payload", { timeout: 100 }),
		).rejects.toMatchObject({ name: "CommandTimeoutError" });
		await expect(execAsyncWithStdin("cat", "payload", { timeout: 5_000 })).resolves.toBe("payload");
	});
});

describe("remote commands over the pooled transport", () => {
	let configDir: string;
	let originalConfigDir: string | undefined;

	const nextChannel = async () => {
		for (let attempt = 0; attempt < 50 && remote.channels.length === 0; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		const channel = remote.channels[0];
		if (!channel) throw new Error("no channel was opened");
		return channel;
	};

	beforeEach(async () => {
		remote.channels.length = 0;
		configDir = await mkdtemp(join(tmpdir(), "nixploy-exec-remote-"));
		originalConfigDir = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = configDir;
	});

	afterEach(async () => {
		closeAllSshConnections();
		if (originalConfigDir === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
		else process.env.NIXPLOY_CONFIG_DIR = originalConfigDir;
		await rm(configDir, { recursive: true, force: true });
	});

	it("resolves stdout on exit 0 and gives the channel slot back", async () => {
		const pending = execAsyncRemote("srv-1", "docker ps -q");
		(await nextChannel()).finish(0, "abc123\n");
		await expect(pending).resolves.toBe("abc123\n");
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
		// The connection itself stays up for the next command.
		expect(getServerTransportState("srv-1").connected).toBe(true);
	});

	it("rejects with RemoteExecError naming the server, keeping stderr off the message", async () => {
		const pending = execAsyncRemote("srv-1", "docker inspect nope");
		(await nextChannel()).finish(1, "", "Error: no such object /var/lib/secret");
		const error = await pending.catch((caught: Error) => caught);
		expect(error).toMatchObject({
			name: "RemoteExecError",
			code: "INTERNAL_SERVER_ERROR",
			exitCode: 1,
			stderr: "Error: no such object /var/lib/secret",
		});
		expect((error as Error).message).toBe('Remote "docker" failed (exit 1) on server prod-1');
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
	});

	it("streams stdin over the channel", async () => {
		const pending = execAsyncRemoteWithStdin("srv-1", "cat > /etc/thing", "payload");
		const channel = await nextChannel();
		channel.finish(0);
		await expect(pending).resolves.toBe("");
		expect(channel.stdin).toEqual(["payload"]);
	});

	it("closes only the channel on timeout, leaving the pooled connection up", async () => {
		const pending = execAsyncRemote("srv-1", "sleep 600", { timeoutMs: 20 });
		const channel = await nextChannel();
		await expect(pending).rejects.toMatchObject({
			name: "RemoteExecError",
			message: 'Remote "sleep" timed out after 0s on server prod-1',
			exitCode: null,
		});
		expect(channel.closed).toBe(true);
		expect(getServerTransportState("srv-1").connected).toBe(true);
		expect(getServerTransportState("srv-1").openChannels).toBe(0);
	});

	it("reuses one connection for several remote commands", async () => {
		const first = execAsyncRemote("srv-1", "echo one");
		(await nextChannel()).finish(0, "one");
		await first;
		remote.channels.length = 0;
		const second = execAsyncRemote("srv-1", "echo two");
		(await nextChannel()).finish(0, "two");
		await expect(second).resolves.toBe("two");
		expect(getServerTransportState("srv-1").connected).toBe(true);
	});
});
