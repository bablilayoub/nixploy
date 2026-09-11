import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth audit rows.
 *
 * Two properties that used to be wrong (security audit 2.9, auth handoff §3b):
 * client IP and user agent were buried in the `metadata` JSON blob because the
 * table had no columns for them, and an event by a user who belonged to no
 * organization was dropped entirely — so impersonating an org-less account, or
 * a failed sign-in before the first organization exists, left no trail at all.
 */

const mocks = vi.hoisted(() => ({
	recordAudit: vi.fn(async () => {}),
	membership: null as { organizationId: string } | null,
	user: { email: "ada@example.com" } as { email: string } | undefined,
}));

vi.mock("../audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("../../db", () => ({
	db: {
		query: {
			members: { findFirst: async () => mocks.membership ?? undefined },
			users: { findFirst: async () => mocks.user },
		},
	},
}));

import { handleAuthEventAfter, recordAuthEvent, requestContext } from "./auth-events";

const ORIGINAL_TRUSTED = process.env.TRUSTED_PROXIES;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.membership = { organizationId: "org-1" };
	mocks.user = { email: "ada@example.com" };
});

afterEach(() => {
	if (ORIGINAL_TRUSTED === undefined) delete process.env.TRUSTED_PROXIES;
	else process.env.TRUSTED_PROXIES = ORIGINAL_TRUSTED;
});

describe("requestContext", () => {
	it("resolves the client IP through the trusted-proxy policy", () => {
		process.env.TRUSTED_PROXIES = "1";
		const headers = new Headers({
			"x-nixploy-peer-ip": "10.0.0.7",
			"x-real-ip": "203.0.113.9",
			"user-agent": "nixploy-cli/0.2.0",
		});
		expect(requestContext({ headers })).toEqual({
			ip: "203.0.113.9",
			userAgent: "nixploy-cli/0.2.0",
		});
	});

	it("never trusts a forwarded header from an untrusted peer", () => {
		process.env.TRUSTED_PROXIES = "1";
		const headers = new Headers({
			"x-nixploy-peer-ip": "198.51.100.4",
			"x-real-ip": "203.0.113.9",
		});
		expect(requestContext({ headers })).toEqual({ ip: "unknown", userAgent: null });
	});

	it("survives a hook context with no headers at all", () => {
		expect(requestContext({})).toEqual({ ip: "unknown", userAgent: null });
	});
});

describe("recordAuthEvent", () => {
	it("writes ip and userAgent as columns, not metadata", async () => {
		await recordAuthEvent({
			userId: "user-1",
			action: "auth.login",
			ip: "203.0.113.9",
			userAgent: "Mozilla/5.0",
			metadata: { method: "password" },
		});
		expect(mocks.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorId: "user-1",
				actorEmail: "ada@example.com",
				action: "auth.login",
				ip: "203.0.113.9",
				userAgent: "Mozilla/5.0",
				metadata: { method: "password" },
			}),
		);
	});

	it("records an instance-level row for a user with no organization", async () => {
		mocks.membership = null;
		await recordAuthEvent({ userId: "user-orphan", action: "auth.login.failed" });
		expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
		expect(mocks.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: null,
				actorId: "user-orphan",
				action: "auth.login.failed",
				ip: null,
				userAgent: null,
				metadata: null,
			}),
		);
	});
});

describe("handleAuthEventAfter", () => {
	const headers = () =>
		new Headers({ "x-nixploy-peer-ip": "10.0.0.7", "x-real-ip": "198.51.100.20" });

	it("puts the request context on a successful sign-out", async () => {
		process.env.TRUSTED_PROXIES = "1";
		await handleAuthEventAfter({
			path: "/sign-out",
			headers: headers(),
			context: { session: { user: { id: "user-1", email: "ada@example.com" } } },
		});
		expect(mocks.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "auth.logout",
				ip: "198.51.100.20",
				// Nothing else to say about a sign-out: the blob stays null rather
				// than carrying the ip/userAgent copy it used to.
				metadata: null,
			}),
		);
	});

	it("keeps admin detail in metadata and the request context in its columns", async () => {
		process.env.TRUSTED_PROXIES = "1";
		await handleAuthEventAfter({
			path: "/admin/set-role",
			body: { userId: "user-2", role: "admin" },
			headers: headers(),
			context: { session: { user: { id: "user-1", email: "ada@example.com" } } },
		});
		expect(mocks.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "admin.user.role.set",
				targetId: "user-2",
				ip: "198.51.100.20",
				metadata: { role: "admin" },
			}),
		);
	});

	it("never throws when the audit write fails", async () => {
		mocks.recordAudit.mockRejectedValueOnce(new Error("database is gone"));
		await expect(
			handleAuthEventAfter({
				path: "/sign-out",
				context: { session: { user: { id: "user-1" } } },
			}),
		).resolves.toBeUndefined();
	});
});
