import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearRemoteHostKey,
	DEFAULT_COMMAND_TIMEOUT_MS,
	describeTimeout,
	execAsync,
	execAsyncWithStdin,
	getGitKnownHostsPath,
	getPinnedHostsDir,
	localCommandTimeoutMs,
	remoteCommandTimeoutMs,
	verifyRemoteHostKey,
} from "./exec";

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
