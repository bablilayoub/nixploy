import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two external boundaries of buildApiKeyContext: better-auth's
// api-key verification and the raw postgres client.
const mocks = vi.hoisted(() => ({
	verifyApiKey: vi.fn(),
	sqlClient: vi.fn(),
}));
vi.mock("./auth", () => ({
	auth: { api: { verifyApiKey: mocks.verifyApiKey } },
}));
vi.mock("../db", () => ({
	client: mocks.sqlClient,
}));

import { buildApiKeyPermissions } from "../modules/auth/api-key-scopes";
import { retryAfterSecondsFromError } from "../utils/rate-limit";
import { buildApiKeyContext } from "./api-key-context";

const req = (headers: Record<string, string>) =>
	new Request("http://localhost/api/mcp", { headers });

const userRow = {
	id: "user-1",
	name: "Ada",
	email: "ada@example.com",
	emailVerified: true,
	image: null,
	role: "user",
	banned: false,
	twoFactorEnabled: false,
	createdAt: new Date(),
	updatedAt: new Date(),
};

describe("buildApiKeyContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects requests without an API key", async () => {
		await expect(buildApiKeyContext(req({}), { bucket: "test-missing" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
			message: "Missing x-api-key header",
		});
		expect(mocks.verifyApiKey).not.toHaveBeenCalled();
	});

	it("accepts Authorization: Bearer when allowBearer is set", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "user-1" },
		});
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-1" }]);

		const ctx = await buildApiKeyContext(req({ authorization: "Bearer secret-key" }), {
			bucket: "test-bearer",
			allowBearer: true,
		});
		expect(mocks.verifyApiKey).toHaveBeenCalledWith({ body: { key: "secret-key" } });
		expect(ctx.session?.user.id).toBe("user-1");
		expect(ctx.session?.session.activeOrganizationId).toBe("org-1");
	});

	it("ignores Authorization: Bearer when allowBearer is not set", async () => {
		await expect(
			buildApiKeyContext(req({ authorization: "Bearer secret-key" }), { bucket: "test-no-bearer" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Missing x-api-key header" });
	});

	it("rejects invalid or expired keys", async () => {
		mocks.verifyApiKey.mockResolvedValue({ valid: false, key: null });
		await expect(
			buildApiKeyContext(req({ "x-api-key": "bad" }), { bucket: "test-invalid" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Invalid or expired API key" });
	});

	it("rejects keys without an owner", async () => {
		mocks.verifyApiKey.mockResolvedValue({ valid: true, key: { id: "key-1" } });
		await expect(
			buildApiKeyContext(req({ "x-api-key": "ownerless" }), { bucket: "test-ownerless" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Unknown API key owner" });
	});

	it("rejects keys whose owner no longer exists", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "ghost" },
		});
		mocks.sqlClient.mockResolvedValueOnce([]); // no user row
		await expect(
			buildApiKeyContext(req({ "x-api-key": "ghost-key" }), { bucket: "test-ghost" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Unknown API key owner" });
	});

	it("rejects banned users", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "user-1" },
		});
		mocks.sqlClient.mockResolvedValueOnce([{ ...userRow, banned: true }]);
		await expect(
			buildApiKeyContext(req({ "x-api-key": "banned-key" }), { bucket: "test-banned" }),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: "User is banned" });
	});

	it("lifts a temporary ban once banExpires has passed", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "user-1" },
		});
		mocks.sqlClient
			.mockResolvedValueOnce([{ ...userRow, banned: true, banExpires: new Date(Date.now() - 1) }])
			.mockResolvedValueOnce([{ organizationId: "org-1" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "expired-ban" }), {
			bucket: "test-ban-expired",
		});
		expect(ctx.session?.user.id).toBe("user-1");
		// The user query must select ban_expires, otherwise the ban never lifts.
		const userQuery = String(mocks.sqlClient.mock.calls[0]?.[0]);
		expect(userQuery).toContain('ban_expires AS "banExpires"');
	});

	it("defaults to the oldest membership when no organization is requested", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "user-1" },
		});
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-oldest" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "k" }), { bucket: "test-default-org" });
		expect(ctx.session?.session.activeOrganizationId).toBe("org-oldest");
		const membershipQuery = String(mocks.sqlClient.mock.calls[1]?.[0]);
		expect(membershipQuery).toContain("ORDER BY created_at ASC");
	});

	it("rate-limits per API key, not per (unknown) IP", async () => {
		const bucket = "test-per-key";
		const verified = (id: string) => ({ valid: true, key: { id, referenceId: "user-1" } });
		mocks.verifyApiKey.mockImplementation(async ({ body }: { body: { key: string } }) =>
			verified(body.key),
		);
		mocks.sqlClient.mockImplementation(async (strings: TemplateStringsArray) =>
			String(strings.join("")).includes('FROM "user"') ? [userRow] : [{ organizationId: "org-1" }],
		);
		for (let i = 0; i < 120; i += 1) {
			await buildApiKeyContext(req({ "x-api-key": "key-a" }), { bucket });
		}
		await expect(
			buildApiKeyContext(req({ "x-api-key": "key-a" }), { bucket }),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		// A different key behind the same (unknown) IP is unaffected.
		await expect(
			buildApiKeyContext(req({ "x-api-key": "key-b" }), { bucket }),
		).resolves.toBeTruthy();
	});

	it("answers the api-key plugin's own rate limit with TOO_MANY_REQUESTS, not UNAUTHORIZED", async () => {
		// better-auth returns the same `{ valid: false }` envelope for a revoked
		// key and for a throttled one; only `error.code` tells them apart. Read
		// as UNAUTHORIZED it said "your key is invalid" to a caller whose key was
		// fine (CLI/MCP audit §12).
		mocks.verifyApiKey.mockResolvedValue({
			valid: false,
			key: null,
			error: {
				code: "RATE_LIMITED",
				message: "Rate limit exceeded.",
				details: { tryAgainIn: 12_400 },
			},
		});
		const error = await buildApiKeyContext(req({ "x-api-key": "throttled" }), {
			bucket: "test-plugin-throttle",
		}).catch((thrown: unknown) => thrown);
		expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
		expect((error as Error).message).toMatch(/rate limit exceeded/i);
		expect(retryAfterSecondsFromError(error)).toBe(13);
	});

	it("carries a Retry-After hint on the per-key bucket rejection", async () => {
		const bucket = "test-per-key-retry";
		mocks.verifyApiKey.mockImplementation(async ({ body }: { body: { key: string } }) => ({
			valid: true,
			key: { id: body.key, referenceId: "user-1" },
		}));
		mocks.sqlClient.mockImplementation(async (strings: TemplateStringsArray) =>
			String(strings.join("")).includes('FROM "user"') ? [userRow] : [{ organizationId: "org-1" }],
		);
		for (let i = 0; i < 120; i += 1) {
			await buildApiKeyContext(req({ "x-api-key": "key-retry" }), { bucket });
		}
		const error = await buildApiKeyContext(req({ "x-api-key": "key-retry" }), { bucket }).catch(
			(thrown: unknown) => thrown,
		);
		expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
		const retryAfter = retryAfterSecondsFromError(error);
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(60);
	});

	it("only counts failed verifications against the per-IP auth bucket", async () => {
		const bucket = "test-auth-failures";
		mocks.verifyApiKey.mockImplementation(async ({ body }: { body: { key: string } }) =>
			body.key === "good"
				? { valid: true, key: { id: `good-${Math.random()}`, referenceId: "user-1" } }
				: { valid: false, key: null },
		);
		mocks.sqlClient.mockImplementation(async (strings: TemplateStringsArray) =>
			String(strings.join("")).includes('FROM "user"') ? [userRow] : [{ organizationId: "org-1" }],
		);
		// Successful verifications must not consume the failure bucket…
		for (let i = 0; i < 50; i += 1) {
			await expect(
				buildApiKeyContext(req({ "x-api-key": "good" }), { bucket }),
			).resolves.toBeTruthy();
		}
		// …so all 600 (30 × the unknown-IP multiplier) failures still fit.
		for (let i = 0; i < 600; i += 1) {
			await expect(
				buildApiKeyContext(req({ "x-api-key": "bad" }), { bucket }),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		}
		await expect(buildApiKeyContext(req({ "x-api-key": "bad" }), { bucket })).rejects.toMatchObject(
			{ code: "TOO_MANY_REQUESTS" },
		);
	});

	it("rejects x-organization-id the user is not a member of", async () => {
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "user-1" },
		});
		mocks.sqlClient.mockResolvedValueOnce([userRow]).mockResolvedValueOnce([]); // no membership
		await expect(
			buildApiKeyContext(req({ "x-api-key": "k", "x-organization-id": "org-2" }), {
				bucket: "test-org",
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Not a member of the requested organization",
		});
	});

	it("honors an explicit x-organization-id when membership exists", async () => {
		mocks.verifyApiKey.mockResolvedValue({ valid: true, key: { id: "key-1", userId: "user-1" } });
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-2" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "k", "x-organization-id": "org-2" }), {
			bucket: "test-org-ok",
		});
		expect(ctx.session?.session.activeOrganizationId).toBe("org-2");
	});
});

describe("buildApiKeyContext scopes and organization binding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const verified = (key: Record<string, unknown>) => ({
		valid: true,
		key: { id: "key-1", referenceId: "user-1", ...key },
	});

	it("leaves legacy keys unscoped (no permissions, no metadata)", async () => {
		mocks.verifyApiKey.mockResolvedValue(verified({}));
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-1" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "legacy" }), {
			bucket: "test-legacy",
		});
		expect(ctx.apiKey).toEqual({
			id: "key-1",
			scope: null,
			organizationId: null,
			legacy: true,
		});
		// No ceiling: the owner's full capability set applies, as before scopes.
		expect(ctx.capabilityScope).toBeUndefined();
	});

	it("carries the scope's capability ceiling on the context", async () => {
		mocks.verifyApiKey.mockResolvedValue(verified({ permissions: buildApiKeyPermissions("read") }));
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-1" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "scoped" }), {
			bucket: "test-scope-read",
		});
		expect(ctx.apiKey.scope).toBe("read");
		expect(ctx.capabilityScope?.label).toBe("API key scope (read)");
		expect([...(ctx.capabilityScope?.allowed ?? [])].sort()).toEqual([
			"audit.read",
			"secrets.read",
		]);
		expect(ctx.capabilityScope?.organizationId).toBeNull();
	});

	it("gives a deploy key exactly the deploy capabilities", async () => {
		mocks.verifyApiKey.mockResolvedValue(
			verified({ permissions: buildApiKeyPermissions("deploy") }),
		);
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-1" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "deployer" }), {
			bucket: "test-scope-deploy",
		});
		const allowed = ctx.capabilityScope?.allowed ?? new Set();
		expect(allowed.has("service.deploy")).toBe(true);
		expect(allowed.has("service.write")).toBe(false);
		expect(allowed.has("servers.manage")).toBe(false);
	});

	it("binds a key to the organization in its metadata", async () => {
		mocks.verifyApiKey.mockResolvedValue(
			verified({
				permissions: buildApiKeyPermissions("deploy"),
				metadata: { organizationId: "org-bound" },
			}),
		);
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-bound" }]);
		const ctx = await buildApiKeyContext(req({ "x-api-key": "bound" }), {
			bucket: "test-bound",
		});
		expect(ctx.session?.session.activeOrganizationId).toBe("org-bound");
		expect(ctx.apiKey.organizationId).toBe("org-bound");
		expect(ctx.capabilityScope?.organizationId).toBe("org-bound");
		// Membership in the bound org is verified, not assumed.
		const membershipQuery = String(mocks.sqlClient.mock.calls[1]?.[0]);
		expect(membershipQuery).toContain("FROM member");
	});

	it("rejects a bound key whose owner left the organization", async () => {
		mocks.verifyApiKey.mockResolvedValue(verified({ metadata: { organizationId: "org-bound" } }));
		mocks.sqlClient.mockResolvedValueOnce([userRow]).mockResolvedValueOnce([]);
		await expect(
			buildApiKeyContext(req({ "x-api-key": "orphan" }), { bucket: "test-bound-orphan" }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Not a member of the organization this API key is bound to",
		});
	});

	it("refuses x-organization-id that contradicts the binding", async () => {
		mocks.verifyApiKey.mockResolvedValue(verified({ metadata: { organizationId: "org-bound" } }));
		mocks.sqlClient.mockResolvedValueOnce([userRow]);
		await expect(
			buildApiKeyContext(req({ "x-api-key": "bound", "x-organization-id": "org-other" }), {
				bucket: "test-bound-cross",
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "This API key is bound to a different organization",
		});
	});

	it("accepts x-organization-id that matches the binding", async () => {
		mocks.verifyApiKey.mockResolvedValue(verified({ metadata: { organizationId: "org-bound" } }));
		mocks.sqlClient
			.mockResolvedValueOnce([userRow])
			.mockResolvedValueOnce([{ organizationId: "org-bound" }]);
		const ctx = await buildApiKeyContext(
			req({ "x-api-key": "bound", "x-organization-id": "org-bound" }),
			{ bucket: "test-bound-same" },
		);
		expect(ctx.session?.session.activeOrganizationId).toBe("org-bound");
	});
});
