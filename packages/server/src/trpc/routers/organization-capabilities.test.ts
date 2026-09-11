import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * `organization.setMemberCapabilities`: capability overlays may not hand a
 * lower-ranked member a capability that reaches the shared host or the
 * organization itself (`minRole` in the catalog — security audit 2.3), and
 * `revoke` is validated the same way `grant` is.
 */

const mocks = vi.hoisted(() => ({
	memberFindFirst: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	assertCapability: vi.fn(async () => {}),
	audit: vi.fn(async () => {}),
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	return {
		...actual,
		db: {
			query: { members: { findFirst: mocks.memberFindFirst } },
			update: () => ({ set: mocks.set }),
		},
		client: vi.fn(),
	};
});
vi.mock("../../modules/projects", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/projects")>();
	return {
		...actual,
		resolveCallerOrganizationId: vi.fn(async () => "org-1"),
		assertCapability: mocks.assertCapability,
	};
});
vi.mock("../../modules/auth/two-factor-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/auth/two-factor-gate")>();
	return { ...actual, isTwoFactorGateBlocked: vi.fn(async () => false) };
});
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));

import { organizationRouter } from "./organization";

const ctx = {
	headers: new Headers(),
	session: {
		user: { id: "owner-user", email: "owner@example.com", role: "user" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const target = {
	id: "member-target",
	organizationId: "org-1",
	userId: "target-user",
	role: "member",
	capabilityOverrides: null,
};
const caller = {
	id: "member-owner",
	organizationId: "org-1",
	userId: "owner-user",
	role: "owner",
	capabilityOverrides: null,
};

/** members.findFirst is called for the target first, then the caller. */
function membershipLookups(targetRow: unknown = target, callerRow: unknown = caller) {
	mocks.memberFindFirst.mockResolvedValueOnce(targetRow).mockResolvedValueOnce(callerRow);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.set.mockReturnValue({ where: mocks.where });
	mocks.where.mockResolvedValue([]);
	mocks.assertCapability.mockResolvedValue(undefined);
});

describe("organization.setMemberCapabilities rank binding", () => {
	it("refuses to grant an infrastructure capability to a member", async () => {
		membershipLookups();
		await expect(
			organizationRouter
				.createCaller(ctx)
				.setMemberCapabilities({ memberId: "member-target", grant: ["servers.manage"] }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: expect.stringContaining("requires the admin role or higher"),
		});
		expect(mocks.set).not.toHaveBeenCalled();
	});

	it("refuses docker.manage, settings.manage and members.manage the same way", async () => {
		for (const capability of ["docker.manage", "settings.manage", "members.manage"] as const) {
			vi.clearAllMocks();
			mocks.set.mockReturnValue({ where: mocks.where });
			mocks.assertCapability.mockResolvedValue(undefined);
			membershipLookups();
			await expect(
				organizationRouter
					.createCaller(ctx)
					.setMemberCapabilities({ memberId: "member-target", grant: [capability] }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(mocks.set).not.toHaveBeenCalled();
		}
	});

	it("allows the same grant once the member is an admin", async () => {
		membershipLookups({ ...target, role: "admin" });
		await expect(
			organizationRouter
				.createCaller(ctx)
				.setMemberCapabilities({ memberId: "member-target", grant: ["servers.manage"] }),
		).resolves.toMatchObject({ memberId: "member-target" });
		expect(mocks.set).toHaveBeenCalledTimes(1);
	});

	it("still allows ordinary capabilities for a plain member", async () => {
		membershipLookups();
		await expect(
			organizationRouter.createCaller(ctx).setMemberCapabilities({
				memberId: "member-target",
				grant: ["service.deploy", "backups.manage"],
			}),
		).resolves.toMatchObject({ memberId: "member-target" });
		expect(mocks.set).toHaveBeenCalledTimes(1);
	});

	it("validates revoke against the caller's own set", async () => {
		membershipLookups(target, { ...caller, role: "deployer" });
		await expect(
			organizationRouter
				.createCaller(ctx)
				.setMemberCapabilities({ memberId: "member-target", revoke: ["docker.manage"] }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: expect.stringContaining("Cannot revoke capability you do not have"),
		});
		expect(mocks.set).not.toHaveBeenCalled();
	});

	it("lets an owner revoke a capability it holds", async () => {
		membershipLookups();
		await expect(
			organizationRouter
				.createCaller(ctx)
				.setMemberCapabilities({ memberId: "member-target", revoke: ["secrets.read"] }),
		).resolves.toMatchObject({ memberId: "member-target" });
		expect(mocks.set).toHaveBeenCalledTimes(1);
	});
});
