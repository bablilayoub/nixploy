import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTRPCContext } from "../test-utils/fake-session";

const mocks = vi.hoisted(() => ({
	resolve: vi.fn(),
	read: vi.fn(async () => ({ secret: "hidden service data" })),
}));
vi.mock("../modules/application/org", () => ({ getOrganizationId: async () => "org-1" }));
vi.mock("../modules/auth/two-factor-gate", () => ({ isTwoFactorGateBlocked: async () => false }));
vi.mock("../modules/auth/sso-gate", () => ({ isSsoGateBlocked: async () => false }));
vi.mock("../modules/projects/project-scope", async (original) => ({
	...(await original<typeof import("../modules/projects/project-scope")>()),
	resolveProjectFilterForSession: mocks.resolve,
}));

import { assertProjectVisible } from "../modules/projects/project-scope";
import { protectedProcedure, router } from "./init";

const routes = router({
	privateData: protectedProcedure.query(async () => {
		assertProjectVisible("hidden", "Service");
		return mocks.read();
	}),
});

beforeEach(() => vi.clearAllMocks());

describe("project resolution failure at the request boundary", () => {
	it("does not enter an otherwise successful data query when visibility resolution fails", async () => {
		mocks.resolve.mockRejectedValueOnce(new Error("Transient visibility query failure"));
		const caller = routes.createCaller(fakeTRPCContext());
		await expect(caller.privateData()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("still hides excluded projects when resolution succeeds", async () => {
		mocks.resolve.mockResolvedValueOnce({ kind: "projects", projectIds: new Set() });
		await expect(routes.createCaller(fakeTRPCContext()).privateData()).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("allows authorized data after a later request resolves successfully", async () => {
		mocks.resolve.mockRejectedValueOnce(new Error("Temporary failure"));
		mocks.resolve.mockResolvedValueOnce({ kind: "projects", projectIds: new Set(["hidden"]) });
		await expect(routes.createCaller(fakeTRPCContext()).privateData()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
		expect(await routes.createCaller(fakeTRPCContext()).privateData()).toEqual({
			secret: "hidden service data",
		});
		expect(mocks.read).toHaveBeenCalledTimes(1);
	});
	it("preserves trusted worker access outside a caller scope", () => {
		expect(() => assertProjectVisible("hidden")).not.toThrow();
	});
});
