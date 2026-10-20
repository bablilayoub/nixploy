import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "../../modules/errors";
import type { TRPCContext } from "../init";

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	getServiceContext: vi.fn(),
	assertCapability: vi.fn(async () => {}),
	audit: vi.fn(async () => {}),
	listBackupRuns: vi.fn(),
	listVolumeBackupKeys: vi.fn(),
	runVolumeBackupNow: vi.fn(async () => {}),
	restoreVolumeBackup: vi.fn(),
	unregisterVolumeBackupSchedule: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

// The database is mocked; declare the fixture's successful SSO gate explicitly.
vi.mock("../../modules/auth/sso-gate", async (original) => ({
	...(await original<typeof import("../../modules/auth/sso-gate")>()),
	isSsoGateBlocked: async () => false,
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	return {
		...actual,
		db: {
			query: { volumeBackups: { findFirst: mocks.findFirst } },
			update: mocks.update,
			delete: mocks.remove,
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
vi.mock("../../modules/projects/project-scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/projects/project-scope")>();
	return { ...actual, resolveProjectFilterForSession: vi.fn(async () => actual.ALL_PROJECTS) };
});
vi.mock("../../modules/application", () => ({ getServiceContext: mocks.getServiceContext }));
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));
vi.mock("../../modules/backups/runner", () => ({
	listVolumeBackupKeys: mocks.listVolumeBackupKeys,
	restoreVolumeBackup: mocks.restoreVolumeBackup,
}));
vi.mock("../../modules/backups/runs", () => ({
	listBackupRuns: mocks.listBackupRuns,
	latestBackupRuns: vi.fn(),
}));
vi.mock("../../modules/backups/scheduler", () => ({
	isValidBackupCron: () => true,
	registerVolumeBackupSchedule: vi.fn(),
	runVolumeBackupNow: mocks.runVolumeBackupNow,
	unregisterVolumeBackupSchedule: mocks.unregisterVolumeBackupSchedule,
}));

import { volumeBackupRouter } from "./volume-backup";

const ctx = {
	headers: new Headers(),
	session: {
		user: { id: "user-1", email: "u@example.com", role: "user" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const row = {
	volumeBackupId: "vb-1",
	name: "data",
	volumeName: "app_data",
	serviceType: "application",
	applicationId: "app-1",
	composeId: null,
	destinationId: "d-1",
	destination: { destinationId: "d-1", organizationId: "org-1", name: "disk" },
};
const key = "volume-backup/app_data/2026-10-15T00-00-00-000Z.gz";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findFirst.mockResolvedValue(row);
	mocks.getServiceContext.mockResolvedValue({ organizationId: "org-1", appName: "app" });
	mocks.listBackupRuns.mockResolvedValue([]);
	mocks.listVolumeBackupKeys.mockResolvedValue([key]);
	mocks.restoreVolumeBackup.mockResolvedValue({ key });
	mocks.update.mockReturnValue({
		set: () => ({ where: () => ({ returning: async () => [row] }) }),
	});
	mocks.remove.mockReturnValue({ where: async () => {} });
});

type Caller = ReturnType<typeof volumeBackupRouter.createCaller>;
const idOperations = [
	{ name: "one", call: (caller: Caller) => caller.one({ volumeBackupId: "vb-1" }) },
	{ name: "runs", call: (caller: Caller) => caller.runs({ volumeBackupId: "vb-1" }) },
	{ name: "listBackups", call: (caller: Caller) => caller.listBackups({ volumeBackupId: "vb-1" }) },
	{ name: "runManually", call: (caller: Caller) => caller.runManually({ volumeBackupId: "vb-1" }) },
	{ name: "restore", call: (caller: Caller) => caller.restore({ volumeBackupId: "vb-1" }) },
	{
		name: "update",
		call: (caller: Caller) => caller.update({ volumeBackupId: "vb-1", enabled: false }),
	},
	{ name: "remove", call: (caller: Caller) => caller.remove({ volumeBackupId: "vb-1" }) },
];

function expectNoVolumeWork() {
	expect(mocks.listBackupRuns).not.toHaveBeenCalled();
	expect(mocks.listVolumeBackupKeys).not.toHaveBeenCalled();
	expect(mocks.runVolumeBackupNow).not.toHaveBeenCalled();
	expect(mocks.restoreVolumeBackup).not.toHaveBeenCalled();
	expect(mocks.update).not.toHaveBeenCalled();
	expect(mocks.remove).not.toHaveBeenCalled();
	expect(mocks.unregisterVolumeBackupSchedule).not.toHaveBeenCalled();
	expect(mocks.audit).not.toHaveBeenCalled();
}

describe.each(["application", "compose"] as const)("%s volume backup ID access", (kind) => {
	beforeEach(() => {
		mocks.findFirst.mockResolvedValue({
			...row,
			serviceType: kind,
			applicationId: kind === "application" ? "linked-service" : null,
			composeId: kind === "compose" ? "linked-service" : null,
		});
	});

	it.each(idOperations)(
		"$name hides a known backup ID in an inaccessible project",
		async ({ call }) => {
			mocks.getServiceContext.mockRejectedValueOnce(notFound("Service not found"));
			await expect(call(volumeBackupRouter.createCaller(ctx))).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			expect(mocks.getServiceContext).toHaveBeenCalledWith(kind, "linked-service");
			expectNoVolumeWork();
		},
	);

	it("returns an accessible backup after checking its linked service", async () => {
		await expect(
			volumeBackupRouter.createCaller(ctx).one({ volumeBackupId: "vb-1" }),
		).resolves.toMatchObject({
			volumeBackupId: "vb-1",
		});
		expect(mocks.getServiceContext).toHaveBeenCalledWith(kind, "linked-service");
	});
});

describe("volume backup authorization and audit", () => {
	it("hides another org's backup before looking up its service", async () => {
		mocks.findFirst.mockResolvedValue({ ...row, destination: { organizationId: "org-2" } });
		await expect(
			volumeBackupRouter.createCaller(ctx).one({ volumeBackupId: "vb-1" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(mocks.getServiceContext).not.toHaveBeenCalled();
	});

	it("hides a linked service from another org even if the destination matches", async () => {
		mocks.getServiceContext.mockResolvedValueOnce({ organizationId: "org-2" });
		await expect(
			volumeBackupRouter.createCaller(ctx).restore({ volumeBackupId: "vb-1" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expectNoVolumeWork();
	});

	it.each([null, "postgres"])("refuses a missing or invalid service link (%s)", async (kind) => {
		mocks.findFirst.mockResolvedValue({
			...row,
			serviceType: kind ?? "application",
			applicationId: null,
		});
		await expect(
			volumeBackupRouter.createCaller(ctx).restore({ volumeBackupId: "vb-1" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(mocks.getServiceContext).not.toHaveBeenCalled();
		expectNoVolumeWork();
	});

	it.each(["runManually", "restore", "update", "remove"] as const)(
		"%s still requires backups.manage",
		async (name) => {
			mocks.assertCapability.mockRejectedValueOnce(forbidden("Capability required"));
			const operation = idOperations.find((op) => op.name === name);
			if (!operation) throw new Error("Missing operation");
			await expect(operation.call(volumeBackupRouter.createCaller(ctx))).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(mocks.findFirst).not.toHaveBeenCalled();
			expectNoVolumeWork();
		},
	);

	it("restores an accessible volume and audits exactly once", async () => {
		await expect(
			volumeBackupRouter.createCaller(ctx).restore({ volumeBackupId: "vb-1", key }),
		).resolves.toEqual({ key });
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "backups.manage");
		expect(mocks.restoreVolumeBackup).toHaveBeenCalledWith(row, key);
		expect(mocks.audit).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action: "volumeBackup.restore", metadata: { key } }),
		);
	});
});
