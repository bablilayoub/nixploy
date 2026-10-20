import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	session: vi.fn(),
	key: vi.fn(),
	lookup: vi.fn(),
	sso: vi.fn(),
	twoFactor: vi.fn(),
	store: vi.fn(async () => 4),
	queue: vi.fn(async () => "dep-1"),
}));
vi.mock("@/lib/auth-server", () => ({ getSession: mocks.session }));
vi.mock("@nixploy/server/lib/api-key-context", () => ({ buildApiKeyContext: mocks.key }));
vi.mock("@nixploy/server/modules/application/org", () => ({
	findApplicationForUser: mocks.lookup,
	findApplicationByAppNameForUser: mocks.lookup,
}));
vi.mock("@nixploy/server/modules/auth/sso-gate", () => ({
	isSsoGateBlocked: mocks.sso,
	SSO_REQUIRED_MESSAGE: "SSO required",
}));
vi.mock("@nixploy/server/modules/auth/two-factor-gate", () => ({
	isTwoFactorGateBlocked: mocks.twoFactor,
	TWO_FACTOR_REQUIRED_MESSAGE: "2FA required",
}));
vi.mock("@nixploy/server/modules/deployment/drop", () => ({
	MAX_DROP_ARCHIVE_BYTES: 1024,
	storeDropArchive: mocks.store,
}));
vi.mock("@nixploy/server/modules/git/webhook-handler", () => ({
	queueWebhookDeployment: mocks.queue,
}));
vi.mock("@nixploy/server/modules/projects/index", () => ({
	hasCapability: async () => true,
	runWithCapabilityScope: (_scope: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@nixploy/server/modules/audit/index", () => ({ recordAudit: async () => {} }));
vi.mock("@nixploy/server/utils/rate-limit", () => ({
	clientIpFromRequest: () => "127.0.0.1",
	takeIpRateLimitToken: () => true,
	takeRateLimitToken: () => true,
}));

import { POST as upload } from "../app/api/applications/[applicationId]/source/route";
import { POST as deploy } from "../app/api/webhooks/deploy/[appName]/route";

const session = { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } };
const routes = [
	[
		"ZIP upload",
		(req: Request) => upload(req, { params: Promise.resolve({ applicationId: "app-1" }) }),
	],
	[
		"deploy webhook",
		(req: Request) => deploy(req, { params: Promise.resolve({ appName: "owned-app" }) }),
	],
] as const;
const request = () => new Request("http://panel.test/api", { method: "POST", body: "PK00" });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.session.mockResolvedValue(session);
	mocks.key.mockResolvedValue({ session, apiKey: { organizationId: "org-1" } });
	mocks.lookup.mockResolvedValue({
		applicationId: "app-1",
		appName: "owned-app",
		name: "Owned app",
		sourceType: "drop",
		environment: { project: { organizationId: "org-1" } },
	});
	mocks.sso.mockResolvedValue(false);
	mocks.twoFactor.mockResolvedValue(false);
});

describe.each(routes)("%s direct authorization", (_name, post) => {
	it("rejects an SSO-gated caller before storage or deployment", async () => {
		mocks.sso.mockResolvedValue(true);
		const req = request();
		const read = vi.spyOn(req, "arrayBuffer");
		const response = await post(req);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ message: "SSO required" });
		expect(mocks.store).not.toHaveBeenCalled();
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
	});
	it("applies the same SSO gate to API-key callers", async () => {
		mocks.session.mockResolvedValue(null);
		mocks.sso.mockResolvedValue(true);
		expect((await post(request())).status).toBe(403);
		expect(mocks.sso).toHaveBeenCalledWith("user-1", "org-1");
	});
	it("keeps hidden or absent applications indistinguishable", async () => {
		mocks.lookup.mockResolvedValue(null);
		expect((await post(request())).status).toBe(404);
		expect(mocks.store).not.toHaveBeenCalled();
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("retains allowed requests and the existing 2FA gate", async () => {
		expect((await post(request())).status).toBe(200);
		mocks.twoFactor.mockResolvedValue(true);
		const response = await post(request());
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ message: "2FA required" });
	});
});
