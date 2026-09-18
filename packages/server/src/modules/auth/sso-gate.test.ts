import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("./sso", () => ({ loadSsoProviders: async () => [] }));

import { checkSsoLockout, shouldRequireSsoSignIn } from "./sso-gate";

describe("shouldRequireSsoSignIn", () => {
	it("lets everyone through when the organization does not require SSO", () => {
		expect(
			shouldRequireSsoSignIn({
				orgRequiresSso: false,
				hasSsoAccount: false,
				isInstanceAdmin: false,
			}),
		).toBe(false);
	});

	it("blocks a member who did not arrive through the IdP", () => {
		expect(
			shouldRequireSsoSignIn({
				orgRequiresSso: true,
				hasSsoAccount: false,
				isInstanceAdmin: false,
			}),
		).toBe(true);
	});

	it("lets a member with a linked SSO identity through", () => {
		expect(
			shouldRequireSsoSignIn({ orgRequiresSso: true, hasSsoAccount: true, isInstanceAdmin: false }),
		).toBe(false);
	});

	it("never gates an instance admin", () => {
		// Break-glass: when the IdP is down or misconfigured, the instance admin
		// is the only way back in. Gating them means nobody can turn it off.
		expect(
			shouldRequireSsoSignIn({ orgRequiresSso: true, hasSsoAccount: false, isInstanceAdmin: true }),
		).toBe(false);
	});
});

describe("checkSsoLockout", () => {
	const owner = (overrides: Partial<{ hasSsoAccount: boolean; userRole: string | null }> = {}) => ({
		role: "owner",
		userRole: null,
		hasSsoAccount: false,
		...overrides,
	});

	it("refuses when the instance has no provider at all", () => {
		const check = checkSsoLockout([owner({ hasSsoAccount: true })], 0);
		expect(check.allowed).toBe(false);
		expect(check.reason).toContain("no SSO provider");
	});

	it("refuses when no admin or owner has ever signed in through SSO", () => {
		// The lockout that matters: flip the switch and the only person who
		// could flip it back cannot sign in.
		const check = checkSsoLockout(
			[owner(), { role: "admin", userRole: null, hasSsoAccount: false }],
			1,
		);
		expect(check.allowed).toBe(false);
		expect(check.reason).toContain("locks everyone out");
	});

	it("allows it once one admin or owner has a linked SSO identity", () => {
		expect(
			checkSsoLockout([owner(), { role: "admin", userRole: null, hasSsoAccount: true }], 1).allowed,
		).toBe(true);
	});

	it("counts an instance admin as a way back in even without an SSO identity", () => {
		// They are exempt from the gate, so they can always sign in with a
		// password and turn the requirement off again.
		expect(checkSsoLockout([owner({ userRole: "admin" })], 1).allowed).toBe(true);
	});

	it("ignores members who could not turn the requirement off anyway", () => {
		// A deployer with SSO does not make the org recoverable: they cannot
		// change organization settings.
		const check = checkSsoLockout(
			[owner(), { role: "deployer", userRole: null, hasSsoAccount: true }],
			1,
		);
		expect(check.allowed).toBe(false);
	});

	it("refuses an organization with no admin or owner at all", () => {
		expect(
			checkSsoLockout([{ role: "member", userRole: null, hasSsoAccount: true }], 1).allowed,
		).toBe(false);
	});
});
