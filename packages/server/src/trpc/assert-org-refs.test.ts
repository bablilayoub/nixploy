import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: { query: {} } }));
vi.mock("../modules/cluster/servers", () => ({
	findServerById: vi.fn(async (id: string, org: string) =>
		id === "srv-ok" && org === "org-a" ? { serverId: id } : null,
	),
}));
vi.mock("../modules/cluster/ssh-keys", () => ({
	findSshKeyById: vi.fn(async (id: string, org: string) =>
		id === "key-ok" && org === "org-a" ? { sshKeyId: id } : null,
	),
}));

import { TRPCError } from "@trpc/server";
import { assertServerInOrganization, assertSshKeyInOrganization } from "./assert-org-refs";

describe("assert-org-refs", () => {
	it("allows null serverId", async () => {
		await expect(assertServerInOrganization(null, "org-a")).resolves.toBeUndefined();
		await expect(assertServerInOrganization(undefined, "org-a")).resolves.toBeUndefined();
	});

	it("allows in-org server", async () => {
		await expect(assertServerInOrganization("srv-ok", "org-a")).resolves.toBeUndefined();
	});

	it("rejects cross-org server", async () => {
		await expect(assertServerInOrganization("srv-other", "org-a")).rejects.toBeInstanceOf(
			TRPCError,
		);
	});

	it("allows in-org ssh key and rejects others", async () => {
		await expect(assertSshKeyInOrganization("key-ok", "org-a")).resolves.toBeUndefined();
		await expect(assertSshKeyInOrganization("key-other", "org-a")).rejects.toBeInstanceOf(
			TRPCError,
		);
	});
});
