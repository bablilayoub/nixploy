import { describe, expect, it } from "vitest";
import { ORG_CAPABILITIES } from "../projects/capabilities";
import {
	API_KEY_PERMISSION_RESOURCE,
	API_KEY_SCOPES,
	apiKeyOrganizationId,
	apiKeyScopeCapabilities,
	buildApiKeyMetadata,
	buildApiKeyPermissions,
	describeApiKey,
	isApiKeyScope,
	parseApiKeyScope,
} from "./api-key-scopes";

describe("api key scope → capability mapping", () => {
	/** Concrete capability list for a scope (never the "all" sentinel). */
	const listFor = (scope: (typeof API_KEY_SCOPES)[number]) => {
		const ceiling = apiKeyScopeCapabilities(scope);
		if (ceiling === "all") throw new Error(`${scope} is unbounded`);
		return ceiling;
	};

	it("read grants only read-shaped capabilities", () => {
		expect([...listFor("read")].sort()).toEqual(["audit.read", "secrets.read"]);
	});

	it("each scope is a superset of the weaker one", () => {
		const scopes = [...API_KEY_SCOPES];
		for (let i = 1; i < scopes.length; i += 1) {
			const previous = scopes[i - 1];
			const current = scopes[i];
			if (!previous || !current) continue;
			const weakerCeiling = apiKeyScopeCapabilities(previous);
			const strongerCeiling = apiKeyScopeCapabilities(current);
			if (weakerCeiling === "all" || strongerCeiling === "all") continue;
			const stronger = new Set(strongerCeiling);
			for (const capability of weakerCeiling) {
				expect(stronger.has(capability)).toBe(true);
			}
		}
	});

	it("deploy adds deploy/runtime but no write capability", () => {
		const deploy = new Set(listFor("deploy"));
		expect(deploy.has("service.deploy")).toBe(true);
		expect(deploy.has("service.runtime")).toBe(true);
		expect(deploy.has("service.write")).toBe(false);
		expect(deploy.has("secrets.write")).toBe(false);
		expect(deploy.has("servers.manage")).toBe(false);
	});

	it("write adds service/domain/secret edits but no infrastructure", () => {
		const write = new Set(listFor("write"));
		expect(write.has("service.write")).toBe(true);
		expect(write.has("domains.manage")).toBe(true);
		expect(write.has("secrets.write")).toBe(true);
		expect(write.has("servers.manage")).toBe(false);
		expect(write.has("docker.manage")).toBe(false);
		expect(write.has("members.manage")).toBe(false);
	});

	it("admin means the unreduced owner set", () => {
		expect(apiKeyScopeCapabilities("admin")).toBe("all");
	});

	it("never grants a capability outside the catalog", () => {
		const catalog = new Set<string>(ORG_CAPABILITIES);
		for (const scope of API_KEY_SCOPES) {
			const ceiling = apiKeyScopeCapabilities(scope);
			if (ceiling === "all") continue;
			for (const capability of ceiling) {
				expect(catalog.has(capability)).toBe(true);
			}
		}
	});
});

describe("parseApiKeyScope", () => {
	it("reads the scope from the better-auth permissions shape", () => {
		expect(parseApiKeyScope({ [API_KEY_PERMISSION_RESOURCE]: ["deploy"] })).toBe("deploy");
		expect(parseApiKeyScope(buildApiKeyPermissions("write"))).toBe("write");
	});

	it("returns null for legacy keys (no permissions column)", () => {
		expect(parseApiKeyScope(null)).toBeNull();
		expect(parseApiKeyScope(undefined)).toBeNull();
		expect(parseApiKeyScope({})).toBeNull();
		expect(parseApiKeyScope({ other: ["read"] })).toBeNull();
		expect(parseApiKeyScope({ [API_KEY_PERMISSION_RESOURCE]: ["nonsense"] })).toBeNull();
		expect(parseApiKeyScope("read")).toBeNull();
	});

	it("takes the strongest scope when several are listed", () => {
		expect(parseApiKeyScope({ [API_KEY_PERMISSION_RESOURCE]: ["read", "write", "deploy"] })).toBe(
			"write",
		);
	});

	it("recognises exactly the four scopes", () => {
		expect(API_KEY_SCOPES.every(isApiKeyScope)).toBe(true);
		expect(isApiKeyScope("owner")).toBe(false);
		expect(isApiKeyScope(null)).toBe(false);
	});
});

describe("organization binding", () => {
	it("reads organizationId out of metadata", () => {
		expect(apiKeyOrganizationId(buildApiKeyMetadata("org-1", "read"))).toBe("org-1");
		expect(apiKeyOrganizationId({ organizationId: "  org-2  " })).toBe("org-2");
	});

	it("treats missing or empty metadata as unbound", () => {
		expect(apiKeyOrganizationId(null)).toBeNull();
		expect(apiKeyOrganizationId({})).toBeNull();
		expect(apiKeyOrganizationId({ organizationId: "" })).toBeNull();
		expect(apiKeyOrganizationId({ organizationId: 7 })).toBeNull();
	});
});

describe("describeApiKey", () => {
	it("flags keys with neither scope nor binding as legacy", () => {
		expect(describeApiKey({})).toEqual({ scope: null, organizationId: null, legacy: true });
	});

	it("falls back to metadata.scope when permissions is empty", () => {
		// `permissions` is a server-only property on /api-key/create, so the
		// panel records the scope in metadata and the column is mirrored after.
		expect(describeApiKey({ metadata: { scope: "deploy", organizationId: "org-1" } })).toEqual({
			scope: "deploy",
			organizationId: "org-1",
			legacy: false,
		});
	});

	it("prefers the permissions column over metadata", () => {
		expect(
			describeApiKey({
				permissions: buildApiKeyPermissions("read"),
				metadata: { scope: "admin" },
			}).scope,
		).toBe("read");
	});

	it("is not legacy once either column is present", () => {
		expect(describeApiKey({ permissions: buildApiKeyPermissions("read") }).legacy).toBe(false);
		expect(describeApiKey({ metadata: buildApiKeyMetadata("org-1", "read") }).legacy).toBe(false);
	});
});
