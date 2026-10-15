import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "../../modules/errors";
import type { TRPCContext } from "../init";

const mocks = vi.hoisted(() => ({
	findDestination: vi.fn(),
	findInstanceBackup: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	assertCapability: vi.fn(async () => {}),
	audit: vi.fn(async () => {}),
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	return {
		...actual,
		db: {
			query: {
				destinations: { findFirst: mocks.findDestination },
				backups: { findFirst: mocks.findInstanceBackup },
			},
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
		hasCapability: vi.fn(async () => true),
	};
});
vi.mock("../../modules/projects/project-scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/projects/project-scope")>();
	return { ...actual, resolveProjectFilterForSession: vi.fn(async () => actual.ALL_PROJECTS) };
});
vi.mock("../../modules/auth/two-factor-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/auth/two-factor-gate")>();
	return { ...actual, isTwoFactorGateBlocked: vi.fn(async () => false) };
});
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));
vi.mock("../../modules/backups/runner", () => ({ testDestination: vi.fn() }));

import { destinationRouter } from "./destination";

const destination = {
	destinationId: "d-1",
	organizationId: "org-1",
	name: "Private off-host backups",
	provider: "s3",
	accessKey: "access-id",
	secretAccessKey: "write-only-secret",
	bucket: "backups",
	region: "us-east-1",
	endpoint: "https://s3.example.test",
};

function context(role = "user"): TRPCContext {
	return {
		headers: new Headers(),
		session: {
			user: { id: "user-1", email: "u@example.com", role },
			session: { activeOrganizationId: "org-1" },
		},
	} as unknown as TRPCContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findDestination.mockResolvedValue(destination);
	mocks.findInstanceBackup.mockResolvedValue(undefined);
	mocks.update.mockReturnValue({
		set: () => ({ where: () => ({ returning: async () => [destination] }) }),
	});
	mocks.remove.mockReturnValue({ where: async () => {} });
});

type Caller = ReturnType<typeof destinationRouter.createCaller>;
const mutations = [
	{
		name: "update",
		action: "destination.update",
		call: (caller: Caller) => caller.update({ destinationId: "d-1", accessKey: "replacement" }),
	},
	{
		name: "remove",
		action: "destination.delete",
		call: (caller: Caller) => caller.remove({ destinationId: "d-1" }),
	},
];

describe.each(mutations)("destination.$name", ({ call, action }) => {
	it("denies an ordinary org admin when any instance backup uses the destination", async () => {
		// The org capability succeeds; the real instance-role check must still deny.
		mocks.findInstanceBackup.mockResolvedValue({ backupId: "instance-backup" });
		await expect(call(destinationRouter.createCaller(context()))).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.assertCapability).toHaveBeenCalledWith("user-1", "org-1", "destinations.manage");
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("allows the instance admin and audits exactly once", async () => {
		mocks.findInstanceBackup.mockResolvedValue({ backupId: "instance-backup" });
		const result = await call(destinationRouter.createCaller(context("admin")));
		expect(result).toMatchObject({ destinationId: "d-1" });
		expect(result).not.toHaveProperty("secretAccessKey");
		expect(mocks.audit).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ action }),
		);
	});

	it("keeps ordinary destinations manageable by the org capability", async () => {
		await expect(call(destinationRouter.createCaller(context()))).resolves.toMatchObject({
			destinationId: "d-1",
		});
		expect(mocks.findInstanceBackup).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledTimes(1);
	});

	it("preserves NOT_FOUND for a foreign or missing destination", async () => {
		mocks.findDestination.mockResolvedValue(undefined);
		await expect(call(destinationRouter.createCaller(context("admin")))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(mocks.findInstanceBackup).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("still requires destinations.manage even for the instance admin", async () => {
		mocks.assertCapability.mockRejectedValueOnce(forbidden("Capability required"));
		await expect(call(destinationRouter.createCaller(context("admin")))).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.findDestination).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});
});
