import { describe, expect, it, vi } from "vitest";

// `setupServer` reaches for SSH, the primary swarm and the Traefik writer; the
// assertions below never get that far (the instance-admin gate is the first
// statement), but the module graph still has to import cleanly.
vi.mock("../../utils/exec", () => ({
	execAsync: vi.fn(async () => ""),
	execAsyncRemote: vi.fn(async () => ""),
}));

import { installRemoteBuilderCommand, REMOTE_BUILDER_TOOLS } from "../deployment/builders/tools";
import { redactServerCommandLog, SKIP_REMOTE_BUILDERS_ENV, setupServer } from "./servers";

describe("redactServerCommandLog", () => {
	it("strips swarm join tokens from the persisted setup log", () => {
		expect(
			redactServerCommandLog("docker swarm join --token SWMTKN-1-abc123def 10.0.0.1:2377"),
		).toBe("docker swarm join --token SWMTKN-*** 10.0.0.1:2377");
		expect(redactServerCommandLog(null)).toBeNull();
	});
});

describe("setupServer", () => {
	it("refuses to join a server to the primary swarm without the instance admin", async () => {
		await expect(setupServer("srv-1", { instanceAdminVerified: false })).rejects.toThrow(
			/instance admin/i,
		);
	});
});

describe("remote builder provisioning", () => {
	it("has an install command for every builder a managed server needs", () => {
		expect(REMOTE_BUILDER_TOOLS.length).toBeGreaterThan(0);
		for (const tool of REMOTE_BUILDER_TOOLS) {
			const command = installRemoteBuilderCommand(tool);
			// Idempotent, arch-resolving, and it verifies what it installed.
			expect(command).toContain(`command -v ${tool.name}`);
			expect(command).toContain('case "$(uname -m)" in');
			expect(command).toContain(`/${tool.version}/`);
			expect(command).toContain(`--version`);
		}
	});

	it("names the documented escape hatch", () => {
		expect(SKIP_REMOTE_BUILDERS_ENV).toBe("NIXPLOY_SKIP_REMOTE_BUILDERS");
	});
});
