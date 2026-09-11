import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: { query: { members: { findFirst: mocks.findFirst } } },
}));

import {
	assertCapability,
	capabilityMinRole,
	effectiveCapabilities,
	getMemberCapabilities,
	hasCapability,
	ORG_CAPABILITIES,
	RANK_BOUND_CAPABILITIES,
	runWithCapabilityScope,
} from "./capabilities";

const membership = (role: string, capabilityOverrides: unknown = null) => ({
	id: "member-1",
	organizationId: "org-1",
	userId: "user-1",
	role,
	capabilityOverrides,
});

describe("capabilityMinRole", () => {
	it("rank-binds the capabilities that reach the host or the org", () => {
		expect(capabilityMinRole("servers.manage")).toBe("admin");
		expect(capabilityMinRole("docker.manage")).toBe("admin");
		expect(capabilityMinRole("settings.manage")).toBe("admin");
		expect(capabilityMinRole("members.manage")).toBe("admin");
	});

	it("leaves ordinary capabilities delegable", () => {
		expect(capabilityMinRole("service.deploy")).toBeNull();
		expect(capabilityMinRole("secrets.read")).toBeNull();
		expect(capabilityMinRole("audit.read")).toBeNull();
	});

	it("lists exactly the rank-bound ids", () => {
		expect([...RANK_BOUND_CAPABILITIES].sort()).toEqual([
			"docker.manage",
			"members.manage",
			"servers.manage",
			"settings.manage",
		]);
	});
});

describe("capability scope (API keys)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findFirst.mockResolvedValue(membership("owner"));
	});

	it("resolves the full role set with no scope in force", async () => {
		const info = await getMemberCapabilities("user-1", "org-1");
		expect(info?.capabilities).toEqual([...ORG_CAPABILITIES].sort());
		expect(await hasCapability("user-1", "org-1", "servers.manage")).toBe(true);
	});

	it("intersects the member set with the scope ceiling", async () => {
		await runWithCapabilityScope(
			{ allowed: new Set(["audit.read", "secrets.read"]), label: "API key scope (read)" },
			async () => {
				const info = await getMemberCapabilities("user-1", "org-1");
				expect(info?.capabilities).toEqual(["audit.read", "secrets.read"]);
				expect(await hasCapability("user-1", "org-1", "service.deploy")).toBe(false);
				expect(await hasCapability("user-1", "org-1", "audit.read")).toBe(true);
			},
		);
	});

	it("never widens a member's own set", async () => {
		mocks.findFirst.mockResolvedValue(membership("viewer"));
		await runWithCapabilityScope({ allowed: new Set(ORG_CAPABILITIES) }, async () => {
			const info = await getMemberCapabilities("user-1", "org-1");
			// viewer's baseline is audit.read only, scope or not.
			expect(info?.capabilities).toEqual(["audit.read"]);
		});
	});

	it("resolves nothing outside the organization a key is bound to", async () => {
		await runWithCapabilityScope(
			{ allowed: new Set(ORG_CAPABILITIES), organizationId: "org-1" },
			async () => {
				expect(
					(await getMemberCapabilities("user-1", "org-1"))?.capabilities.length,
				).toBeGreaterThan(0);
				expect(await hasCapability("user-1", "org-2", "service.deploy")).toBe(false);
				expect((await getMemberCapabilities("user-1", "org-2"))?.capabilities).toEqual([]);
			},
		);
	});

	it("mentions the scope in the assertCapability error", async () => {
		await runWithCapabilityScope(
			{ allowed: new Set(["audit.read"]), label: "API key scope (read)" },
			async () => {
				await expect(assertCapability("user-1", "org-1", "service.deploy")).rejects.toMatchObject({
					code: "FORBIDDEN",
					message: expect.stringContaining("API key scope (read)"),
				});
			},
		);
	});

	it("does not leak out of the scoped call", async () => {
		await runWithCapabilityScope({ allowed: new Set(["audit.read"]) }, async () => {
			expect(await hasCapability("user-1", "org-1", "service.deploy")).toBe(false);
		});
		expect(await hasCapability("user-1", "org-1", "service.deploy")).toBe(true);
	});
});

describe("effectiveCapabilities", () => {
	it("applies grant then revoke on top of the role baseline", () => {
		const set = effectiveCapabilities("member", {
			grant: ["service.deploy"],
			revoke: ["secrets.read"],
		});
		expect(set.has("service.deploy")).toBe(true);
		expect(set.has("secrets.read")).toBe(false);
		expect(set.has("project.write")).toBe(true);
	});
});
