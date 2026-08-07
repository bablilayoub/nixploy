import { describe, expect, it } from "vitest";
import {
	CAPABILITY_CATALOG,
	effectiveCapabilities,
	ORG_CAPABILITIES,
	parseCapabilityOverrides,
	primaryOrgRole,
	ROLE_CAPABILITIES,
} from "./capabilities";

describe("capability catalog", () => {
	it("has unique ids matching ORG_CAPABILITIES", () => {
		const ids = CAPABILITY_CATALOG.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect([...ORG_CAPABILITIES].sort()).toEqual([...ids].sort());
	});

	it("admin baseline includes every catalog capability", () => {
		expect([...ROLE_CAPABILITIES.admin].sort()).toEqual([...ORG_CAPABILITIES].sort());
	});
});

describe("effectiveCapabilities", () => {
	it("gives deployer service.deploy by default", () => {
		const caps = effectiveCapabilities("deployer");
		expect(caps.has("service.deploy")).toBe(true);
		expect(caps.has("service.runtime")).toBe(true);
		expect(caps.has("servers.manage")).toBe(false);
	});

	it("grants and revokes overlays", () => {
		const caps = effectiveCapabilities("member", {
			grant: ["service.deploy"],
			revoke: ["secrets.write"],
		});
		expect(caps.has("service.deploy")).toBe(true);
		expect(caps.has("secrets.write")).toBe(false);
		expect(caps.has("project.write")).toBe(true);
		expect(caps.has("ai.use")).toBe(true);
	});

	it("treats unknown roles as viewer (audit.read only)", () => {
		expect([...effectiveCapabilities("custom-role")].sort()).toEqual(["audit.read"]);
	});

	it("resolves comma-separated better-auth roles", () => {
		expect(primaryOrgRole("member,admin")).toBe("admin");
		expect(effectiveCapabilities("member,deployer").has("service.deploy")).toBe(true);
	});

	it("admin baseline matches ROLE_CAPABILITIES", () => {
		expect([...effectiveCapabilities("admin")].sort()).toEqual([...ROLE_CAPABILITIES.admin].sort());
	});
});

describe("parseCapabilityOverrides", () => {
	it("filters invalid capability names", () => {
		expect(
			parseCapabilityOverrides({
				grant: ["service.deploy", "nope"],
				revoke: ["secrets.read"],
			}),
		).toEqual({
			grant: ["service.deploy"],
			revoke: ["secrets.read"],
		});
	});
});
