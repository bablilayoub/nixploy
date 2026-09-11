import { afterEach, describe, expect, it } from "vitest";
import {
	discoveryUrlForIssuer,
	isSsoRequestPath,
	publicSsoInfo,
	ssoConfig,
	ssoEnabled,
} from "./sso";

const KEYS = [
	"NIXPLOY_OIDC_ISSUER",
	"NIXPLOY_OIDC_CLIENT_ID",
	"NIXPLOY_OIDC_CLIENT_SECRET",
	"NIXPLOY_OIDC_PROVIDER_NAME",
	"NIXPLOY_OIDC_DEFAULT_ORG",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of KEYS) {
		const value = original[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const configure = (overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) => {
	process.env.NIXPLOY_OIDC_ISSUER = "https://auth.example.com/application/o/nixploy/";
	process.env.NIXPLOY_OIDC_CLIENT_ID = "client-id";
	process.env.NIXPLOY_OIDC_CLIENT_SECRET = "client-secret";
	for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
};

describe("ssoConfig", () => {
	it("is off until issuer, client id and secret are all set", () => {
		for (const key of KEYS) delete process.env[key];
		expect(ssoConfig()).toBeNull();
		expect(ssoEnabled()).toBe(false);

		process.env.NIXPLOY_OIDC_ISSUER = "https://auth.example.com";
		expect(ssoEnabled()).toBe(false);
		process.env.NIXPLOY_OIDC_CLIENT_ID = "client-id";
		expect(ssoEnabled()).toBe(false);
		process.env.NIXPLOY_OIDC_CLIENT_SECRET = "client-secret";
		expect(ssoEnabled()).toBe(true);
	});

	it("derives the discovery URL and tolerates a trailing slash", () => {
		expect(discoveryUrlForIssuer("https://auth.example.com/realms/x")).toBe(
			"https://auth.example.com/realms/x/.well-known/openid-configuration",
		);
		expect(discoveryUrlForIssuer("https://auth.example.com/realms/x///")).toBe(
			"https://auth.example.com/realms/x/.well-known/openid-configuration",
		);
	});

	it("defaults the button label and reads the JIT org slug", () => {
		configure();
		delete process.env.NIXPLOY_OIDC_PROVIDER_NAME;
		delete process.env.NIXPLOY_OIDC_DEFAULT_ORG;
		expect(ssoConfig()).toMatchObject({ name: "SSO", defaultOrganizationSlug: null });

		configure({ NIXPLOY_OIDC_PROVIDER_NAME: "Authentik", NIXPLOY_OIDC_DEFAULT_ORG: "acme-ops" });
		expect(ssoConfig()).toMatchObject({
			name: "Authentik",
			defaultOrganizationSlug: "acme-ops",
			providerId: "oidc",
		});
	});
});

describe("publicSsoInfo", () => {
	it("never exposes the client secret", () => {
		configure({ NIXPLOY_OIDC_PROVIDER_NAME: "Keycloak" });
		const info = publicSsoInfo();
		expect(info).toEqual({ enabled: true, providerId: "oidc", name: "Keycloak" });
		expect(JSON.stringify(info)).not.toContain("client-secret");
	});

	it("reports disabled without throwing when nothing is configured", () => {
		for (const key of KEYS) delete process.env[key];
		expect(publicSsoInfo()).toEqual({ enabled: false, providerId: "oidc", name: "SSO" });
	});
});

describe("isSsoRequestPath", () => {
	it("recognises the social sign-in and callback routes", () => {
		expect(isSsoRequestPath("/sign-in/social")).toBe(true);
		expect(isSsoRequestPath("/callback/oidc")).toBe(true);
		expect(isSsoRequestPath("/callback/:id")).toBe(true);
	});

	it("does not treat password sign-up as SSO (registration stays closed)", () => {
		expect(isSsoRequestPath("/sign-up/email")).toBe(false);
		expect(isSsoRequestPath("/sign-in/email")).toBe(false);
		expect(isSsoRequestPath(null)).toBe(false);
		expect(isSsoRequestPath(undefined)).toBe(false);
	});
});
