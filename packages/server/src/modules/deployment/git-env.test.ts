import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gitProcessEnv, gitProtocolEnv, hardenedSimpleGit } from "./sources";

const dir = mkdtempSync(join(tmpdir(), "nixploy-git-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("hardened git environment", () => {
	it("simple-git accepts the env-config channel and git honours it", async () => {
		// Regression: simple-git refused every local clone with
		// `Use of "GIT_CONFIG_COUNT" is not permitted` once gitProtocolEnv() landed.
		const git = hardenedSimpleGit(dir);
		git.env(gitProcessEnv(gitProtocolEnv()));
		await git.init();
		const config = await git.raw(["config", "--list"]);
		expect(config).toContain("protocol.allow=never");
		expect(config).toContain("protocol.file.allow=never");
	});

	it("forwards only what git needs from the panel environment", () => {
		const env = gitProcessEnv({ GIT_TERMINAL_PROMPT: "0" });
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.PATH).toBe(process.env.PATH);
		expect("ENCRYPTION_KEY" in env).toBe(false);
		expect("DATABASE_URL" in env).toBe(false);
	});

	it("still refuses local-file transport with the v4 environment allowlist", async () => {
		const git = hardenedSimpleGit(dir);
		git.env(gitProcessEnv(gitProtocolEnv()));
		await expect(git.clone(`file://${dir}`, join(dir, "refused-clone"))).rejects.toThrow(
			/transport 'file' not allowed/,
		);
	});

	it("permits the platform SSH command without allowing editor execution", async () => {
		const git = hardenedSimpleGit(dir);
		git.env(gitProcessEnv({ ...gitProtocolEnv(), GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }));
		await git.init();
		git.env(gitProcessEnv({ ...gitProtocolEnv(), VISUAL: "untrusted-editor" }));
		await expect(git.raw(["config", "--list"])).rejects.toThrow(
			/VISUAL.*(?:blocked|not permitted)/,
		);
	});
});
