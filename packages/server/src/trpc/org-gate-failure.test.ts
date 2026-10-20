import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTRPCContext } from "../test-utils/fake-session";

const mocks = vi.hoisted(() => ({
	organization: vi.fn(),
	twoFactor: vi.fn(),
	sso: vi.fn(),
	read: vi.fn(async () => ({ data: "tenant data" })),
}));
vi.mock("../modules/application/org", () => ({ getOrganizationId: mocks.organization }));
vi.mock("../modules/auth/two-factor-gate", () => ({
	isTwoFactorGateBlocked: mocks.twoFactor,
	TWO_FACTOR_REQUIRED_MESSAGE: "2FA required",
}));
vi.mock("../modules/auth/sso-gate", () => ({
	isSsoGateBlocked: mocks.sso,
	SSO_REQUIRED_MESSAGE: "SSO required",
}));
vi.mock("../modules/projects/project-scope", async (original) => ({
	...(await original<typeof import("../modules/projects/project-scope")>()),
	resolveProjectFilterForSession: async () => ({ kind: "all" as const }),
}));

import { forbidden } from "../modules/errors";
import { protectedProcedure, router } from "./init";

const routes = router({
	data: protectedProcedure.query(() => mocks.read()),
	account: protectedProcedure.query(({ ctx }) => ({ userId: ctx.session.user.id })),
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.organization.mockResolvedValue("org-1");
	mocks.twoFactor.mockResolvedValue(false);
	mocks.sso.mockResolvedValue(false);
});

describe("organization security gate lookup failures", () => {
	it.each(["twoFactor", "sso"] as const)(
		"rejects a %s lookup failure before a healthy data query",
		async (gate) => {
			mocks[gate].mockRejectedValueOnce(new Error("Gate query unavailable"));
			await expect(routes.createCaller(fakeTRPCContext()).data()).rejects.toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
			});
			expect(mocks.read).not.toHaveBeenCalled();
		},
	);
	it("allows a later request after its gate queries recover", async () => {
		mocks.sso.mockRejectedValueOnce(new Error("Temporary gate failure"));
		await expect(routes.createCaller(fakeTRPCContext()).data()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
		expect(await routes.createCaller(fakeTRPCContext()).data()).toEqual({ data: "tenant data" });
		expect(mocks.read).toHaveBeenCalledOnce();
	});
	it("keeps account procedures available when the caller has no organization", async () => {
		mocks.organization.mockRejectedValueOnce(forbidden("No organization"));
		expect(await routes.createCaller(fakeTRPCContext({ organizationId: null })).account()).toEqual({
			userId: "user-1",
		});
		expect(mocks.twoFactor).not.toHaveBeenCalled();
		expect(mocks.sso).not.toHaveBeenCalled();
	});
	it("rejects an organization lookup error instead of treating it as no membership", async () => {
		mocks.organization.mockRejectedValueOnce(new Error("Membership lookup unavailable"));
		await expect(routes.createCaller(fakeTRPCContext()).data()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("keeps normal 2FA and SSO policy denials", async () => {
		mocks.twoFactor.mockResolvedValue(true);
		await expect(routes.createCaller(fakeTRPCContext()).data()).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "2FA required",
		});
		mocks.twoFactor.mockResolvedValue(false);
		mocks.sso.mockResolvedValue(true);
		await expect(routes.createCaller(fakeTRPCContext()).data()).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "SSO required",
		});
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("fails closed for API-key callers and permits recovery", async () => {
		mocks.sso.mockRejectedValueOnce(new Error("Temporary gate failure"));
		await expect(
			routes.createCaller(fakeTRPCContext({ apiKey: true })).data(),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		expect(await routes.createCaller(fakeTRPCContext({ apiKey: true })).data()).toEqual({
			data: "tenant data",
		});
		expect(mocks.read).toHaveBeenCalledOnce();
	});
});
