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
