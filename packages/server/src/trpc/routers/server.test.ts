import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * Swarm joins are cluster-wide (audit 2026-09 §2.3): `servers.manage` lets an
 * org register and edit its hosts, but only the instance admin may request a
 * manager role or run `setup` (the join itself). Everything below the router
 * is mocked; the cluster module has its own guard test.
 */

const mocks = vi.hoisted(() => ({
	createServer: vi.fn(),
	findServerById: vi.fn(),
	updateServerById: vi.fn(),
	setupServer: vi.fn(),
	audit: vi.fn(async () => {}),
}));

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
	};
});
vi.mock("../../modules/auth/two-factor-gate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/auth/two-factor-gate")>();
	return { ...actual, isTwoFactorGateBlocked: vi.fn(async () => false) };
});
vi.mock("../../modules/cluster", () => ({
	createServer: mocks.createServer,
	findServerById: mocks.findServerById,
	updateServerById: mocks.updateServerById,
	setupServer: mocks.setupServer,
	getServerStatsBatch: vi.fn(),
	getServerStatsCached: vi.fn(),
	listServersByOrganization: vi.fn(async () => []),
	redactServerCommandLog: (value: string | null | undefined) => value ?? null,
	removeServer: vi.fn(),
	testConnection: vi.fn(),
}));
vi.mock("../../modules/audit", () => ({ auditFromSession: mocks.audit }));
vi.mock("../../utils/exec", () => ({ clearRemoteHostKey: vi.fn() }));
vi.mock("../assert-org-refs", () => ({ assertSshKeyInOrganization: vi.fn(async () => {}) }));

import { serverRouter } from "./server";

const workerRow = {
	serverId: "srv-1",
	organizationId: "org-1",
	name: "node-a",
	ipAddress: "203.0.113.10",
	port: 22,
	username: "root",
	sshKeyId: null,
	swarmRole: "worker",
	serverStatus: "inactive",
	metricsConfig: null,
	command: null,
};

const ctxFor = (role: string | null): TRPCContext =>
	({
		headers: new Headers(),
		session: {
			user: { id: "user-1", email: "u@example.com", role },
			session: { activeOrganizationId: "org-1" },
		},
	}) as unknown as TRPCContext;

const baseCreate = { name: "node-b", ipAddress: "203.0.113.11" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createServer.mockImplementation(async (input: object) => ({
		...workerRow,
		serverId: "srv-new",
		...input,
	}));
	mocks.findServerById.mockResolvedValue(workerRow);
	mocks.updateServerById.mockImplementation(async (_id: string, values: object) => ({
		...workerRow,
		...values,
	}));
	mocks.setupServer.mockResolvedValue("$ echo ok\nok");
});

describe("server.create", () => {
	it("lets servers.manage register a worker (default role)", async () => {
		const caller = serverRouter.createCaller(ctxFor("user"));
		await caller.create(baseCreate);
		await caller.create({ ...baseCreate, swarmRole: "worker" });
		expect(mocks.createServer).toHaveBeenCalledTimes(2);
	});

	it("refuses a manager role for anyone but the instance admin", async () => {
		const caller = serverRouter.createCaller(ctxFor("user"));
		await expect(caller.create({ ...baseCreate, swarmRole: "manager" })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.createServer).not.toHaveBeenCalled();
	});

	it("lets the instance admin register a manager", async () => {
		const caller = serverRouter.createCaller(ctxFor("admin"));
		await caller.create({ ...baseCreate, swarmRole: "manager" });
		expect(mocks.createServer).toHaveBeenCalledWith(
			expect.objectContaining({ swarmRole: "manager" }),
			"org-1",
		);
	});
});

describe("server.update", () => {
	it("refuses promoting a worker to manager without the instance admin role", async () => {
		const caller = serverRouter.createCaller(ctxFor("user"));
		await expect(caller.update({ serverId: "srv-1", swarmRole: "manager" })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(mocks.updateServerById).not.toHaveBeenCalled();
	});

	it("keeps an admin-created manager row editable by the org", async () => {
		mocks.findServerById.mockResolvedValue({ ...workerRow, swarmRole: "manager" });
		const caller = serverRouter.createCaller(ctxFor("user"));
		await caller.update({ serverId: "srv-1", name: "renamed", swarmRole: "manager" });
		expect(mocks.updateServerById).toHaveBeenCalled();
	});
});

describe("server.setup", () => {
	it("is instance-admin only, whatever the requested role", async () => {
		const caller = serverRouter.createCaller(ctxFor("user"));
		await expect(caller.setup({ serverId: "srv-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(mocks.setupServer).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("runs the join for the instance admin and audits it with the role", async () => {
		const caller = serverRouter.createCaller(ctxFor("admin"));
		const result = await caller.setup({ serverId: "srv-1" });
		expect(result.command).toContain("echo ok");
		expect(mocks.setupServer).toHaveBeenCalledWith("srv-1", { instanceAdminVerified: true });
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({
				action: "server.setup",
				targetId: "srv-1",
				metadata: { swarmRole: "worker", result: "ok" },
			}),
		);
	});

	it("audits a failed join and rethrows", async () => {
		mocks.findServerById.mockResolvedValue({ ...workerRow, swarmRole: "manager" });
		mocks.setupServer.mockRejectedValue(new Error("ssh: connection refused"));
		const caller = serverRouter.createCaller(ctxFor("admin"));
		await expect(caller.setup({ serverId: "srv-1" })).rejects.toThrow("connection refused");
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ metadata: { swarmRole: "manager", result: "failed" } }),
		);
	});
});
