import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearRemoteHostKey,
	getGitKnownHostsPath,
	getPinnedHostsDir,
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
