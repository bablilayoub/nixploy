import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * Shared organization env (`organization.environment` / `saveEnvironment`):
 * the writer needs `settings.manage` + `secrets.write`, the reader redacts
 * the dotenv string for members without `secrets.read`, and the value lands
 * in the same `metadata.env` slot `resolveEnvironmentVariables` reads.
 */

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	assertCapability: vi.fn(async (_user: string, _org: string, _capability: string) => {}),
	hasCapability: vi.fn(async (_user: string, _org: string, _capability: string) => true),
	audit: vi.fn(async () => {}),
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

	it("treats missing or malformed metadata as no variables", async () => {
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

	it("writes metadata.env and keeps the other metadata keys", async () => {
		const caller = organizationRouter.createCaller(ctx);
		await expect(caller.saveEnvironment({ env: "A=1\nB=two words" })).resolves.toEqual({
			organizationId: "org-1",
			env: "A=1\nB=two words",
		});
		expect(mocks.set).toHaveBeenCalledTimes(1);
		const [values] = mocks.set.mock.calls[0] as [{ metadata: string }];
		expect(JSON.parse(values.metadata)).toEqual({
			quotas: { maxProjects: 3 },
			env: "A=1\nB=two words",
		});
		// protectedProcedure augments the context (organizationId(), …) — match loosely.
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
