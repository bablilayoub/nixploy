import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * Shared organization env (`organization.environment` / `saveEnvironment`):
 * the writer needs `settings.manage` + `secrets.write`, the reader redacts
 * the dotenv string for members without `secrets.read`, and the value lands
 * in encrypted storage outside organization metadata.
 */

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	set: vi.fn(),
	loadEnv: vi.fn(async () => "SHARED=1\nTOKEN=abc"),
	saveEnv: vi.fn(async () => {}),
	where: vi.fn(),
	assertCapability: vi.fn(async (_user: string, _org: string, _capability: string) => {}),
	hasCapability: vi.fn(async (_user: string, _org: string, _capability: string) => true),
	audit: vi.fn(async () => {}),
}));

vi.mock("../../modules/auth/sso-gate", async (original) => ({
	...(await original<typeof import("../../modules/auth/sso-gate")>()),
	isSsoGateBlocked: async () => false,
}));

// The database boundary below is stubbed; this fixture has an unrestricted caller.
// Project denial and resolution failures are exercised with real scopes separately.
vi.mock("../../modules/projects/project-scope", async (original) => ({
	...(await original<typeof import("../../modules/projects/project-scope")>()),
	resolveProjectFilterForSession: async () => ({ kind: "all" as const }),
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	const update = () => ({ set: mocks.set });
	return {
		...actual,
		db: { query: { organizations: { findFirst: mocks.findFirst } }, update },
		client: vi.fn(),
	};
});
vi.mock("../../modules/projects", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/projects")>();
	return {
		...actual,
		resolveCallerOrganizationId: vi.fn(async () => "org-1"),
		assertCapability: mocks.assertCapability,
		hasCapability: mocks.hasCapability,
	};
});
vi.mock("../../modules/auth/two-factor-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/auth/two-factor-gate")>();
	return { ...actual, isTwoFactorGateBlocked: vi.fn(async () => false) };
});
vi.mock("../../modules/projects/organization-env", () => ({
	loadOrganizationEnvironment: mocks.loadEnv,
	saveOrganizationEnvironment: mocks.saveEnv,
}));
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));

import { TRPCError } from "@trpc/server";
import { organizationRouter } from "./organization";

const ctx = {
	headers: new Headers(),
	session: {
		user: { id: "user-1", email: "u@example.com", role: "user" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const orgRow = {
	id: "org-1",
	name: "Acme",
	metadata: JSON.stringify({ quotas: { maxProjects: 3 }, env: "SHARED=1\nTOKEN=abc" }),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findFirst.mockResolvedValue(orgRow);
	mocks.where.mockResolvedValue([]);
	mocks.set.mockReturnValue({ where: mocks.where });
	mocks.hasCapability.mockResolvedValue(true);
	mocks.loadEnv.mockResolvedValue("SHARED=1\nTOKEN=abc");
	mocks.assertCapability.mockResolvedValue(undefined);
});

describe("organization.environment", () => {
	it("returns the dotenv string for members with secrets.read", async () => {
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.environment()).resolves.toEqual({
			organizationId: "org-1",
			env: "SHARED=1\nTOKEN=abc",
			redacted: false,
		});
	});

	it("redacts the value for members without secrets.read", async () => {
		mocks.hasCapability.mockResolvedValue(false);
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.environment()).resolves.toEqual({
			organizationId: "org-1",
			env: null,
			redacted: true,
		});
	});

	it("reads encrypted storage rather than legacy metadata", async () => {
		mocks.loadEnv.mockResolvedValue("");
		mocks.findFirst.mockResolvedValue({ ...orgRow, metadata: "{not json" });
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.environment()).resolves.toMatchObject({ env: "" });
	});
});

describe("organization.saveEnvironment", () => {
	it("requires settings.manage and secrets.write", async () => {
		mocks.assertCapability.mockImplementation(async (_user: string, _org: string, capability) => {
			if (capability === "secrets.write") {
				throw new TRPCError({ code: "FORBIDDEN", message: "Missing capability" });
			}
		});
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.saveEnvironment({ env: "A=1" })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "settings.manage");
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "secrets.write");
		expect(mocks.set).not.toHaveBeenCalled();
	});

	it("writes encrypted organization storage without returning secrets or changing metadata", async () => {
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.saveEnvironment({ env: "A=1\nB=two words" })).resolves.toEqual({
			organizationId: "org-1",
		});
		expect(mocks.saveEnv).toHaveBeenCalledWith("org-1", "A=1\nB=two words");
		expect(mocks.set).not.toHaveBeenCalled();
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action: "organization.environment" }),
		);
	});

	it("rejects env blobs above the shared text cap", async () => {
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.saveEnvironment({ env: "x".repeat(1_048_577) })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
