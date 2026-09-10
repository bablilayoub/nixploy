import { describe, expect, it, vi } from "vitest";

/**
 * `setupServer` performs the actual `docker swarm join`; the router gates it
 * on the instance admin and passes `instanceAdminVerified`. The module must
 * refuse without that token so no future caller can join a node by mistake.
 */

const mocks = vi.hoisted(() => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findFirst: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: {
		query: { servers: { findFirst: mocks.findFirst } },
		select: () => ({ from: () => ({ limit: async () => [] }) }),
		update: () => ({ set: () => ({ where: async () => [] }) }),
	},
}));
vi.mock("../../utils/exec", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));
vi.mock("./swarm-node", () => ({ inspectPrimaryNode: vi.fn(async () => null) }));

import { redactServerCommandLog, setupServer } from "./servers";

describe("setupServer guard", () => {
	it("refuses to join without the instance-admin token and never touches SSH", async () => {
		mocks.findFirst.mockResolvedValue({ serverId: "srv-1", swarmRole: "manager" });
		await expect(setupServer("srv-1", { instanceAdminVerified: false })).rejects.toThrow(
			/instance admin/,
		);
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execAsync).not.toHaveBeenCalled();
	});
});

describe("redactServerCommandLog", () => {
	it("masks swarm join tokens", () => {
		expect(redactServerCommandLog("docker swarm join --token SWMTKN-1-abc-def 10.0.0.1:2377")).toBe(
			"docker swarm join --token SWMTKN-*** 10.0.0.1:2377",
		);
	});
});
