import { describe, expect, it } from "vitest";
import {
	type AppAuthIdentity,
	emailDomainOf,
	evaluateAppAuthPolicy,
	groupsOf,
	isBypassPath,
	nixployAuthConfigSchema,
} from "./policy";

/**
 * Forward-auth policy. The interesting cases are the ones where a rule must
 * NOT narrow (an empty list) and the ones where it must not be fooled (an
 * email domain suffix, a traversal in a bypass path).
 */

const identity = (overrides: Partial<AppAuthIdentity> = {}): AppAuthIdentity => ({
	userId: "user_1",
	email: "casey@example.com",
	name: "Casey",
	role: "member",
	teams: [{ teamId: "team_1", name: "Platform" }],
	projectVisible: true,
	...overrides,
});

describe("evaluateAppAuthPolicy", () => {
	it("lets any member through when nothing narrows", () => {
		expect(evaluateAppAuthPolicy({}, identity())).toEqual({ allowed: true });
	});

	it("refuses somebody who is not in the organization", () => {
		const decision = evaluateAppAuthPolicy({}, identity({ role: null }));
		expect(decision.allowed).toBe(false);
	});

	it("refuses a member whose teams do not reach the project the app is in", () => {
		// Same question as the panel asks, answered the same way — otherwise the
		// app's own hostname would be a second door into a hidden project.
		const decision = evaluateAppAuthPolicy({}, identity({ projectVisible: false }));
		expect(decision).toMatchObject({ allowed: false });
		if (!decision.allowed) expect(decision.reason).toContain("teams do not reach");
	});

	it("does not let an explicit user id override the project scope", () => {
		expect(
			evaluateAppAuthPolicy({ userIds: ["user_1"] }, identity({ projectVisible: false })),
		).toMatchObject({ allowed: false });
	});

	it("enforces the minimum role by rank, not by equality", () => {
		expect(evaluateAppAuthPolicy({ minRole: "deployer" }, identity({ role: "admin" }))).toEqual({
			allowed: true,
		});
		const denied = evaluateAppAuthPolicy({ minRole: "deployer" }, identity({ role: "viewer" }));
		expect(denied).toMatchObject({ allowed: false });
		if (!denied.allowed) expect(denied.reason).toContain("deployer");
	});

	it("treats an explicit user id as a grant that skips the other rules", () => {
		expect(
			evaluateAppAuthPolicy(
				{ minRole: "owner", teamIds: ["team_other"], userIds: ["user_1"] },
				identity(),
			),
		).toEqual({ allowed: true });
	});

	it("passes a member of any listed team and refuses the rest", () => {
		expect(evaluateAppAuthPolicy({ teamIds: ["team_x", "team_1"] }, identity())).toEqual({
			allowed: true,
		});
		expect(evaluateAppAuthPolicy({ teamIds: ["team_x"] }, identity())).toMatchObject({
			allowed: false,
		});
	});

	it("does not narrow on an empty list", () => {
		// A policy that locked everyone out would be indistinguishable from a
		// misconfiguration, and the operator would lose the app they protected.
		expect(
			evaluateAppAuthPolicy({ teamIds: [], userIds: [], emailDomains: [] }, identity()),
		).toEqual({ allowed: true });
	});

	it("matches an email domain exactly", () => {
		expect(evaluateAppAuthPolicy({ emailDomains: ["example.com"] }, identity())).toEqual({
			allowed: true,
		});
		// `endsWith` would admit this one.
		expect(
			evaluateAppAuthPolicy(
				{ emailDomains: ["example.com"] },
				identity({ email: "casey@notexample.com" }),
			),
		).toMatchObject({ allowed: false });
	});
});

describe("emailDomainOf", () => {
	it("takes everything after the LAST @", () => {
		expect(emailDomainOf('"a@b"@example.com')).toBe("example.com");
	});
	it("refuses an address with no local part or no domain", () => {
		expect(emailDomainOf("@example.com")).toBeNull();
		expect(emailDomainOf("casey@")).toBeNull();
		expect(emailDomainOf("casey")).toBeNull();
	});
});

describe("isBypassPath", () => {
	it("matches the prefix and its children, not a sibling", () => {
		expect(isBypassPath("/healthz", ["/healthz"])).toBe(true);
		expect(isBypassPath("/healthz/live", ["/healthz"])).toBe(true);
		expect(isBypassPath("/healthz?x=1", ["/healthz"])).toBe(true);
		expect(isBypassPath("/healthzzz", ["/healthz"])).toBe(false);
	});

	it("refuses a traversal, encoded or not", () => {
		expect(isBypassPath("/healthz/../admin", ["/healthz"])).toBe(false);
		expect(isBypassPath("/healthz/%2e%2e/admin", ["/healthz"])).toBe(false);
	});

	it("is off when no bypass is configured", () => {
		expect(isBypassPath("/healthz", undefined)).toBe(false);
		expect(isBypassPath("/healthz", [])).toBe(false);
	});
});

describe("groupsOf", () => {
	it("is the role plus every team name", () => {
		expect(groupsOf(identity())).toEqual(["member", "Platform"]);
	});
	it("is empty for a non-member", () => {
		expect(groupsOf(identity({ role: null }))).toEqual([]);
	});
});

describe("nixployAuthConfigSchema", () => {
	it("refuses a bypass path that is not a plain absolute path", () => {
		for (const bad of ["healthz", "http://x/", "/a/../b"]) {
			expect(nixployAuthConfigSchema.safeParse({ bypassPaths: [bad] }).success).toBe(false);
		}
	});

	it("lowercases email domains and refuses a non-domain", () => {
		const parsed = nixployAuthConfigSchema.parse({ emailDomains: ["Example.COM"] });
		expect(parsed.emailDomains).toEqual(["example.com"]);
		expect(nixployAuthConfigSchema.safeParse({ emailDomains: ["not a domain"] }).success).toBe(
			false,
		);
	});

	it("caps the session length at a week", () => {
		expect(nixployAuthConfigSchema.safeParse({ sessionHours: 169 }).success).toBe(false);
		expect(nixployAuthConfigSchema.safeParse({ sessionHours: 168 }).success).toBe(true);
	});
});
