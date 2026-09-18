import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

import {
	extractGroups,
	isEmailDomainAllowed,
	isSsoRequestPath,
	resolveRoleFromGroups,
} from "./sso";
import { discoveryUrlForIssuer, isSsoPreset, SSO_PRESET_INFO, ssoRedirectUri } from "./sso-presets";

describe("discoveryUrlForIssuer", () => {
	it("appends the well-known path, with or without a trailing slash", () => {
		expect(discoveryUrlForIssuer("https://auth.example.com/application/o/nixploy/")).toBe(
			"https://auth.example.com/application/o/nixploy/.well-known/openid-configuration",
		);
		expect(discoveryUrlForIssuer("https://auth.example.com")).toBe(
			"https://auth.example.com/.well-known/openid-configuration",
		);
	});
});

describe("ssoRedirectUri", () => {
	it("is the URI an operator registers at the IdP", () => {
		// `genericOAuth` registers each provider as a *social* provider, so the
		// callback is better-auth's core /callback/:id route, not the plugin's
		// own /oauth2/callback/:id. Verified against a real Keycloak round trip;
		// getting it wrong costs the operator a redirect-uri mismatch at the IdP
		// with nothing on our side to explain it.
		expect(ssoRedirectUri("https://panel.example.com/", "okta")).toBe(
			"https://panel.example.com/api/auth/callback/okta",
		);
	});
});

describe("presets", () => {
	it("gives every preset a label, scopes and a note", () => {
		for (const [preset, info] of Object.entries(SSO_PRESET_INFO)) {
			expect(info.label, preset).toBeTruthy();
			expect(info.defaultScopes.length, preset).toBeGreaterThan(0);
			expect(info.note, preset).toBeTruthy();
		}
	});

	it("gives the one non-OIDC provider explicit endpoints", () => {
		// GitHub has no discovery document, so a `fixed` preset must carry the
		// endpoints itself or the provider simply cannot be built.
		expect(SSO_PRESET_INFO.github.kind).toBe("fixed");
		expect(SSO_PRESET_INFO.github.endpoints?.tokenUrl).toContain("github.com");
		for (const [preset, info] of Object.entries(SSO_PRESET_INFO)) {
			if (info.kind === "fixed") expect(info.endpoints, preset).toBeDefined();
		}
	});

	it("rejects an unknown preset", () => {
		expect(isSsoPreset("keycloak")).toBe(true);
		expect(isSsoPreset("not-a-preset")).toBe(false);
		expect(isSsoPreset(null)).toBe(false);
	});
});

describe("isEmailDomainAllowed", () => {
	it("admits anyone when no domain is configured", () => {
		expect(isEmailDomainAllowed("someone@anywhere.test", [])).toBe(true);
	});

	it("matches the exact domain, case-insensitively, with or without an @", () => {
		expect(isEmailDomainAllowed("Ops@Example.com", ["example.com"])).toBe(true);
		expect(isEmailDomainAllowed("ops@example.com", ["@Example.com"])).toBe(true);
		expect(isEmailDomainAllowed("ops@example.com", [" example.com "])).toBe(true);
	});

	it("does not admit a domain that merely ends with an allowed one", () => {
		// `endsWith("example.com")` would admit this, and anyone who can register
		// notexample.com would be in.
		expect(isEmailDomainAllowed("attacker@notexample.com", ["example.com"])).toBe(false);
		expect(isEmailDomainAllowed("attacker@example.com.evil.test", ["example.com"])).toBe(false);
	});

	it("refuses an address with no domain at all", () => {
		expect(isEmailDomainAllowed("not-an-email", ["example.com"])).toBe(false);
	});
});

describe("extractGroups", () => {
	it("reads a list claim", () => {
		expect(extractGroups({ groups: ["ops", "dev"] }, "groups")).toEqual(["ops", "dev"]);
	});

	it("reads a space- or comma-separated string claim", () => {
		// Some IdPs emit one string rather than a list.
		expect(extractGroups({ groups: "ops dev" }, "groups")).toEqual(["ops", "dev"]);
		expect(extractGroups({ groups: "ops, dev" }, "groups")).toEqual(["ops", "dev"]);
	});

	it("is empty when the claim is missing, unset or not a string list", () => {
		expect(extractGroups({ groups: ["ops"] }, null)).toEqual([]);
		expect(extractGroups({}, "groups")).toEqual([]);
		expect(extractGroups({ groups: 42 }, "groups")).toEqual([]);
		expect(extractGroups(null, "groups")).toEqual([]);
		expect(extractGroups({ groups: [1, "ops", null] }, "groups")).toEqual(["ops"]);
	});
});

describe("resolveRoleFromGroups", () => {
	const mappings = { ops: "admin", everyone: "viewer", deployers: "deployer" };

	it("gives the highest mapped role, not the first", () => {
		// Someone in several groups gets the more capable of them, which is what
		// adding a group to a user is understood to do.
		expect(resolveRoleFromGroups(["everyone", "ops"], mappings)).toBe("admin");
		expect(resolveRoleFromGroups(["ops", "everyone"], mappings)).toBe("admin");
		expect(resolveRoleFromGroups(["everyone", "deployers"], mappings)).toBe("deployer");
	});

	it("matches group names case-insensitively", () => {
		// IdPs disagree about casing, and a mapping that silently never fires is
		// worse than a wrong one.
		expect(resolveRoleFromGroups(["OPS"], mappings)).toBe("admin");
		expect(resolveRoleFromGroups([" Ops "], mappings)).toBe("admin");
	});

	it("is null when nothing matches, so the caller falls back to the default role", () => {
		expect(resolveRoleFromGroups([], mappings)).toBeNull();
		expect(resolveRoleFromGroups(["contractors"], mappings)).toBeNull();
	});

	it("ignores a mapping to a role that does not exist", () => {
		expect(resolveRoleFromGroups(["ops"], { ops: "superuser" })).toBeNull();
	});
});

describe("isSsoRequestPath", () => {
	it("recognises the sign-in and callback paths", () => {
		expect(isSsoRequestPath("/sign-in/social")).toBe(true);
		expect(isSsoRequestPath("/callback/oidc")).toBe(true);
		expect(isSsoRequestPath("/oauth2/callback/okta")).toBe(true);
	});

	it("does not treat an ordinary auth route as SSO", () => {
		// This predicate is what lets a user be created while public
		// registration is closed, so it must not be generous.
		expect(isSsoRequestPath("/sign-up/email")).toBe(false);
		expect(isSsoRequestPath("/sign-in/email")).toBe(false);
		expect(isSsoRequestPath(null)).toBe(false);
		expect(isSsoRequestPath("")).toBe(false);
	});
});
