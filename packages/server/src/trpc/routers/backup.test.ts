import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "../../modules/errors";
import { DATABASE_KINDS, serviceIdField } from "../../modules/services/kinds";
import type { TRPCContext } from "../init";

/**
 * Backup router: run history is org-scoped through the destination, manual
 * runs/restores/verifications are audited, and `verify` is gated by
 * `backups.manage` (plus the instance-admin role for instance backups).
 * Everything below the router is mocked.
 */

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	findMany: vi.fn(),
	assertCapability: vi.fn(async () => {}),
	assertInstanceAdmin: vi.fn(async () => {}),
	getServiceContext: vi.fn(),
	audit: vi.fn(async () => {}),
	verifyBackup: vi.fn(),
	restoreBackup: vi.fn(),
	listBackupKeys: vi.fn(),
	runBackupNow: vi.fn(async () => {}),
	listBackupRuns: vi.fn(),
	latestBackupRuns: vi.fn(),
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
		db: { query: { backups: { findFirst: mocks.findFirst, findMany: mocks.findMany } } },
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
vi.mock("../../modules/auth/instance-admin", () => ({
	assertInstanceAdmin: mocks.assertInstanceAdmin,
}));
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));
vi.mock("../../modules/application", () => ({ getServiceContext: mocks.getServiceContext }));
vi.mock("../../modules/backups/runner", () => ({
	verifyBackup: mocks.verifyBackup,
	restoreBackup: mocks.restoreBackup,
	listBackupKeys: mocks.listBackupKeys,
}));
vi.mock("../../modules/backups/runs", () => ({
	listBackupRuns: mocks.listBackupRuns,
	latestBackupRuns: mocks.latestBackupRuns,
}));
vi.mock("../../modules/backups/scheduler", () => ({
	isValidBackupCron: () => true,
	registerBackupSchedule: vi.fn(),
	runBackupNow: mocks.runBackupNow,
	unregisterBackupSchedule: vi.fn(),
}));

import { backupRouter } from "./backup";

const ctx: TRPCContext = {
	headers: new Headers(),
	session: {
		user: { id: "user-1", email: "u@example.com", role: "user" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const backupRow = {
	backupId: "b-1",
	appName: "shop-db",
	schedule: "0 3 * * *",
	enabled: true,
	prefix: "backup",
	database: "shop",
	databaseType: "postgres",
	keepLatestCount: null,
	destinationId: "d-1",
	postgresId: "pg-1",
	mysqlId: null,
	mariadbId: null,
	mongoId: null,
	redisId: null,
	createdAt: new Date(),
	destination: { destinationId: "d-1", organizationId: "org-1", name: "bucket" },
};

const runRow = {
	backupRunId: "run-1",
	backupId: "b-1",
	volumeBackupId: null,
	organizationId: "org-1",
	kind: "database",
	status: "success",
	startedAt: new Date(),
	finishedAt: new Date(),
	bytes: 1024,
	objectKey: "backup/shop-db/2026-09-11T00-00-00-000Z.gz",
	destinationId: "d-1",
	error: null,
	trigger: "manual",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findFirst.mockResolvedValue(backupRow);
	mocks.getServiceContext.mockResolvedValue({ organizationId: "org-1", appName: "shop-db" });
	mocks.listBackupRuns.mockResolvedValue([runRow]);
	mocks.latestBackupRuns.mockResolvedValue(new Map([["b-1", runRow]]));
	mocks.verifyBackup.mockResolvedValue({ key: runRow.objectKey, bytes: 1024 });
	mocks.restoreBackup.mockResolvedValue({ key: runRow.objectKey });
});

type Caller = ReturnType<typeof backupRouter.createCaller>;
const idOperations = [
	{ name: "one", call: (caller: Caller) => caller.one({ backupId: "b-1" }) },
	{ name: "runs", call: (caller: Caller) => caller.runs({ backupId: "b-1" }) },
	{ name: "listBackups", call: (caller: Caller) => caller.listBackups({ backupId: "b-1" }) },
	{ name: "runManually", call: (caller: Caller) => caller.runManually({ backupId: "b-1" }) },
	{ name: "restore", call: (caller: Caller) => caller.restore({ backupId: "b-1" }) },
	{ name: "verify", call: (caller: Caller) => caller.verify({ backupId: "b-1" }) },
	{ name: "update", call: (caller: Caller) => caller.update({ backupId: "b-1", enabled: false }) },
	{ name: "remove", call: (caller: Caller) => caller.remove({ backupId: "b-1" }) },
];

function expectNoBackupWork() {
	expect(mocks.listBackupRuns).not.toHaveBeenCalled();
	expect(mocks.listBackupKeys).not.toHaveBeenCalled();
	expect(mocks.runBackupNow).not.toHaveBeenCalled();
	expect(mocks.restoreBackup).not.toHaveBeenCalled();
	expect(mocks.verifyBackup).not.toHaveBeenCalled();
	expect(mocks.audit).not.toHaveBeenCalled();
}

describe("backup ID access", () => {
	it.each(idOperations)(
		"$name hides a known backup ID in an inaccessible project",
		async ({ call }) => {
			mocks.getServiceContext.mockRejectedValueOnce(notFound("Service not found"));
			await expect(call(backupRouter.createCaller(ctx))).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			expect(mocks.getServiceContext).toHaveBeenCalledWith("postgres", "pg-1");
			expectNoBackupWork();
		},
	);

	it.each(DATABASE_KINDS)(
		"resolves the linked %s service before returning its backup",
		async (kind) => {
			mocks.findFirst.mockResolvedValue({
				...backupRow,
				postgresId: null,
				databaseType: kind,
				[serviceIdField(kind)]: "linked-service",
			});
			await backupRouter.createCaller(ctx).one({ backupId: "b-1" });
			expect(mocks.getServiceContext).toHaveBeenCalledWith(kind, "linked-service");
		},
	);

	it("hides a linked service from another organization even if the destination matches", async () => {
		mocks.getServiceContext.mockResolvedValueOnce({ organizationId: "org-2" });
		await expect(backupRouter.createCaller(ctx).one({ backupId: "b-1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("refuses a database backup without its matching service link", async () => {
		mocks.findFirst.mockResolvedValue({ ...backupRow, postgresId: null });
		await expect(backupRouter.createCaller(ctx).one({ backupId: "b-1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(mocks.getServiceContext).not.toHaveBeenCalled();
	});

	it.each(idOperations)(
		"$name requires the instance admin for an instance backup",
		async ({ call }) => {
			mocks.findFirst.mockResolvedValue({
				...backupRow,
				databaseType: "web-server",
				postgresId: null,
			});
			mocks.assertInstanceAdmin.mockRejectedValueOnce(forbidden("Instance admin required"));
			await expect(call(backupRouter.createCaller(ctx))).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(mocks.getServiceContext).not.toHaveBeenCalled();
			expectNoBackupWork();
		},
	);

	it("allows the instance admin to read an instance backup without a service link", async () => {
		mocks.findFirst.mockResolvedValue({
			...backupRow,
			databaseType: "web-server",
			postgresId: null,
		});
		await backupRouter.createCaller(ctx).one({ backupId: "b-1" });
		expect(mocks.assertInstanceAdmin).toHaveBeenCalledTimes(1);
		expect(mocks.getServiceContext).not.toHaveBeenCalled();
	});

	it("requires the instance admin before listing instance backups", async () => {
		mocks.assertInstanceAdmin.mockRejectedValueOnce(forbidden("Instance admin required"));
		await expect(
			backupRouter.createCaller(ctx).all({ databaseType: "web-server" }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.findMany).not.toHaveBeenCalled();
	});
});

describe("backup.runs", () => {
	it("lists the history of an org-owned backup (default 20)", async () => {
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.runs({ backupId: "b-1" })).resolves.toEqual([runRow]);
		expect(mocks.listBackupRuns).toHaveBeenCalledWith({ backupId: "b-1" }, 20);
		await caller.runs({ backupId: "b-1", limit: 5 });
		expect(mocks.listBackupRuns).toHaveBeenLastCalledWith({ backupId: "b-1" }, 5);
	});

	it("hides another org's backup", async () => {
		mocks.findFirst.mockResolvedValue({
			...backupRow,
			destination: { ...backupRow.destination, organizationId: "org-2" },
		});
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.runs({ backupId: "b-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(mocks.listBackupRuns).not.toHaveBeenCalled();
	});
});

describe("backup.all", () => {
	it("attaches the last run to instance backups of the caller's org only", async () => {
		mocks.findMany.mockResolvedValue([
			{ ...backupRow, databaseType: "web-server" },
			{
				...backupRow,
				backupId: "b-2",
				databaseType: "web-server",
				destination: { ...backupRow.destination, organizationId: "org-2" },
			},
		]);
		const caller = backupRouter.createCaller(ctx);
		const rows = await caller.all({ databaseType: "web-server" });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ backupId: "b-1", lastRun: runRow });
		expect(rows[0]).not.toHaveProperty("destination");
		expect(mocks.latestBackupRuns).toHaveBeenCalledWith({ backupIds: ["b-1"] });
	});
});

describe("backup.runManually / restore", () => {
	it("audits a manual run", async () => {
		const caller = backupRouter.createCaller(ctx);
		await caller.runManually({ backupId: "b-1" });
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "backups.manage");
		expect(mocks.runBackupNow).toHaveBeenCalledWith(backupRow);
		expect(mocks.audit).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action: "backup.run", targetId: "b-1", targetName: "shop-db" }),
		);
	});

	it("audits a restore with the key that was restored", async () => {
		const caller = backupRouter.createCaller(ctx);
		await caller.restore({ backupId: "b-1", key: runRow.objectKey });
		expect(mocks.restoreBackup).toHaveBeenCalledWith(backupRow, runRow.objectKey);
		expect(mocks.audit).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action: "backup.restore", metadata: { key: runRow.objectKey } }),
		);
	});

	it("rejects traversal-shaped keys before touching the runner", async () => {
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.restore({ backupId: "b-1", key: "../x" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(mocks.restoreBackup).not.toHaveBeenCalled();
	});
});

describe("backup.verify", () => {
	it("requires backups.manage, runs the verification and audits it", async () => {
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.verify({ backupId: "b-1", key: runRow.objectKey })).resolves.toEqual({
			key: runRow.objectKey,
			bytes: 1024,
		});
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "backups.manage");
		expect(mocks.verifyBackup).toHaveBeenCalledWith(backupRow, runRow.objectKey);
		expect(mocks.assertInstanceAdmin).not.toHaveBeenCalled();
		expect(mocks.audit).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({
				action: "backup.verify",
				targetId: "b-1",
				metadata: { key: runRow.objectKey, bytes: 1024 },
			}),
		);
	});

	it("refuses without the capability", async () => {
		mocks.assertCapability.mockRejectedValueOnce(
			Object.assign(new Error("nope"), { code: "FORBIDDEN" }),
		);
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.verify({ backupId: "b-1" })).rejects.toThrow("nope");
		expect(mocks.verifyBackup).not.toHaveBeenCalled();
	});

	it("needs the instance admin for instance backups", async () => {
		mocks.findFirst.mockResolvedValue({ ...backupRow, databaseType: "web-server" });
		mocks.assertInstanceAdmin.mockRejectedValueOnce(new Error("instance admin only"));
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.verify({ backupId: "b-1" })).rejects.toThrow("instance admin only");
		expect(mocks.verifyBackup).not.toHaveBeenCalled();
	});

	it("surfaces a failed verification as BAD_REQUEST with the runner's message", async () => {
		mocks.verifyBackup.mockRejectedValueOnce(new Error('postgres liveness query answered ""'));
		const caller = backupRouter.createCaller(ctx);
		await expect(caller.verify({ backupId: "b-1" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: 'postgres liveness query answered ""',
		});
		expect(mocks.audit).not.toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action: "backup.verify" }),
		);
	});
});
