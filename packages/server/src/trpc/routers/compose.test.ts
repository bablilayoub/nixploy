import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * `compose.update` on a host-privileged row (audit 2026-09 §2.5): a member
 * holding `service.write` must not be able to re-point an instance-admin
 * template (Portainer, Dozzle, …) at their own repository — the next deploy
 * would render it with `/var/run/docker.sock` allowed.
 */

const mocks = vi.hoisted(() => ({
	findComposeForOrg: vi.fn(),
	updateComposeById: vi.fn(),
	saveComposeFile: vi.fn(),
}));

// `trpc/init` builds better-auth at import time from the schema barrel, so
// keep the real module and only blank the query client.
vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	return { ...actual, db: { query: {} }, client: vi.fn() };
});
vi.mock("../../modules/projects", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/projects")>();
	return {
		...actual,
		resolveCallerOrganizationId: vi.fn(async () => "org-1"),
		assertCapability: vi.fn(async () => {}),
		hasCapability: vi.fn(async () => true),
		assertWithinQuota: vi.fn(async () => {}),
	};
});
vi.mock("../../modules/auth/two-factor-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/auth/two-factor-gate")>();
	return { ...actual, isTwoFactorGateBlocked: vi.fn(async () => false) };
});
vi.mock("../../modules/compose/service", () => ({
	findComposeForOrg: mocks.findComposeForOrg,
	updateComposeById: mocks.updateComposeById,
	saveComposeFile: mocks.saveComposeFile,
	createCompose: vi.fn(),
	deleteCompose: vi.fn(),
	duplicateCompose: vi.fn(),
	loadServices: vi.fn(),
	saveEnvironment: vi.fn(),
	startCompose: vi.fn(),
	stopCompose: vi.fn(),
}));
vi.mock("../../modules/compose/containers", () => ({
	listComposeContainers: vi.fn(),
	invalidateComposeContainers: vi.fn(),
}));
vi.mock("../../modules/deployment", () => ({ queueDeployment: vi.fn() }));
vi.mock("../../modules/audit", () => ({ auditFromSession: vi.fn(async () => {}) }));

import { composeRouter } from "./compose";

const row = {
	composeId: "cmp-1",
	name: "portainer",
	appName: "portainer-abc123",
	sourceType: "raw",
	composeFile: "",
	env: null,
	hostPrivileged: true,
	environmentId: "env-1",
	environment: { project: { organizationId: "org-1" } },
};

const ctxFor = (role: string | null): TRPCContext =>
	({
		headers: new Headers(),
		session: {
			user: { id: "user-1", email: "u@example.com", role },
			session: { activeOrganizationId: "org-1" },
		},
	}) as unknown as TRPCContext;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findComposeForOrg.mockResolvedValue(row);
	mocks.updateComposeById.mockImplementation(async (_id: string, values: object) => ({
		...row,
		...values,
	}));
	mocks.saveComposeFile.mockResolvedValue(undefined);
});

describe("compose.update on a host-privileged row", () => {
	it("is FORBIDDEN for a member with service.write who is not the instance admin", async () => {
		const caller = composeRouter.createCaller(ctxFor("user"));
		await expect(
			caller.update({
				composeId: "cmp-1",
				sourceType: "git",
				gitUrl: "https://evil.example/x.git",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(mocks.updateComposeById).not.toHaveBeenCalled();
	});

	it("is FORBIDDEN even for a harmless field (the row is instance-admin only)", async () => {
		const caller = composeRouter.createCaller(ctxFor("user"));
		await expect(caller.update({ composeId: "cmp-1", name: "renamed" })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("passes for the instance admin and tells the service to keep the flag", async () => {
		const caller = composeRouter.createCaller(ctxFor("admin"));
		await caller.update({ composeId: "cmp-1", gitUrl: "https://github.com/acme/portainer.git" });
		expect(mocks.updateComposeById).toHaveBeenCalledWith(
			"cmp-1",
			expect.objectContaining({ gitUrl: "https://github.com/acme/portainer.git" }),
			{ callerIsInstanceAdmin: true },
		);
	});

	it("does not gate ordinary rows and reports a non-admin caller to the service", async () => {
		mocks.findComposeForOrg.mockResolvedValue({ ...row, hostPrivileged: false });
		const caller = composeRouter.createCaller(ctxFor("user"));
		await caller.update({ composeId: "cmp-1", gitUrl: "https://github.com/acme/app.git" });
		expect(mocks.updateComposeById).toHaveBeenCalledWith("cmp-1", expect.anything(), {
			callerIsInstanceAdmin: false,
		});
	});
});

describe("compose.saveComposeFile on a host-privileged row", () => {
	it("is FORBIDDEN for a non-admin", async () => {
		const caller = composeRouter.createCaller(ctxFor("user"));
		await expect(
			caller.saveComposeFile({ composeId: "cmp-1", composeFile: "services: {}\n" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(mocks.saveComposeFile).not.toHaveBeenCalled();
	});

	it("passes the instance-admin flag through for the admin", async () => {
		const caller = composeRouter.createCaller(ctxFor("admin"));
		await caller.saveComposeFile({ composeId: "cmp-1", composeFile: "services: {}\n" });
		expect(mocks.saveComposeFile).toHaveBeenCalledWith(row, "services: {}\n", {
			callerIsInstanceAdmin: true,
		});
	});
});

describe("compose input size caps", () => {
	it("rejects a compose file over 1 MiB before touching the row", async () => {
		const caller = composeRouter.createCaller(ctxFor("admin"));
		await expect(
			caller.saveComposeFile({ composeId: "cmp-1", composeFile: "x".repeat(1_048_577) }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(mocks.findComposeForOrg).not.toHaveBeenCalled();
	});

	it("rejects more than 50 watch paths and pathological globs", async () => {
		const caller = composeRouter.createCaller(ctxFor("admin"));
		await expect(
			caller.update({ composeId: "cmp-1", watchPaths: Array.from({ length: 51 }, () => "src") }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			caller.update({ composeId: "cmp-1", watchPaths: ["**a**a**a**a**a**a"] }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(mocks.updateComposeById).not.toHaveBeenCalled();
	});
});
