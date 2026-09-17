import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../init";

/**
 * `application.deploy` pre-flight (UX audit F2) and provenance: an app whose
 * source cannot be fetched is refused before a row is queued, and the queued
 * job records who started it (`manual` for a browser session, `api` for an
 * API key).
 */

const mocks = vi.hoisted(() => ({
	assertApplicationAccess: vi.fn(),
	queueDeployment: vi.fn(async () => "dep-1"),
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
vi.mock("../../modules/application", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../modules/application")>();
	return { ...actual, assertApplicationAccess: mocks.assertApplicationAccess };
});
vi.mock("../../modules/deployment", async () => {
	// Real readiness predicate and ref validation, stubbed queue.
	const provenance = await import("../../modules/deployment/provenance");
	const ref = await import("../../modules/deployment/ref");
	return {
		...provenance,
		...ref,
		queueDeployment: mocks.queueDeployment,
		cancelDeployment: vi.fn(),
	};
});
vi.mock("../../modules/audit", () => ({ auditFromSession: vi.fn(async () => {}) }));

import { applicationRouter } from "./application";

const baseRow = {
	applicationId: "app-1",
	appName: "app-1-abc",
	name: "app",
	sourceType: "git" as const,
	gitUrl: null as string | null,
	dockerImage: null as string | null,
	owner: null,
	repository: null,
	serverId: null,
	environment: { project: { organizationId: "org-1" } },
};

const ctxFor = (session: Record<string, unknown>): TRPCContext =>
	({
		headers: new Headers(),
		session: {
			user: { id: "user-1", email: "u@example.com", role: "member" },
			session: { activeOrganizationId: "org-1", ...session },
		},
	}) as unknown as TRPCContext;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.assertApplicationAccess.mockResolvedValue(baseRow);
});

describe("application.deploy pre-flight", () => {
	it("refuses a git application with no repository URL before queuing", async () => {
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await expect(caller.deploy({ applicationId: "app-1" })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: "Set a repository URL or Docker image first",
		});
		expect(mocks.queueDeployment).not.toHaveBeenCalled();
	});

	it("refuses a docker application with no image, on redeploy too", async () => {
		mocks.assertApplicationAccess.mockResolvedValue({ ...baseRow, sourceType: "docker" });
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await expect(caller.redeploy({ applicationId: "app-1" })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(mocks.queueDeployment).not.toHaveBeenCalled();
	});
});

describe("application.deploy provenance", () => {
	it("records a browser session as a manual deploy by the user", async () => {
		mocks.assertApplicationAccess.mockResolvedValue({
			...baseRow,
			sourceType: "docker",
			dockerImage: "traefik/whoami:v1.10.1",
		});
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await expect(caller.deploy({ applicationId: "app-1", title: "  " })).resolves.toEqual({
			applicationId: "app-1",
			deploymentId: "dep-1",
		});
		expect(mocks.queueDeployment).toHaveBeenCalledWith({
			applicationId: "app-1",
			type: "deploy",
			title: undefined,
			trigger: "manual",
			triggeredBy: "user-1",
		});
	});

	it("passes a trimmed requested ref through to the queue", async () => {
		// The ref rides the JOB, never the row: nothing here writes to the
		// application, so the configured branch survives a one-off deploy.
		// `buildRefDeployTarget` (worker.test.ts) covers the other half.
		mocks.assertApplicationAccess.mockResolvedValue({
			...baseRow,
			sourceType: "github" as const,
			owner: "acme",
			repository: "web",
		});
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await caller.deploy({ applicationId: "app-1", ref: " v1.2.0 " });
		expect(mocks.queueDeployment).toHaveBeenCalledWith(
			expect.objectContaining({ applicationId: "app-1", type: "deploy", ref: "v1.2.0" }),
		);
	});

	it("refuses a ref on a docker-image source instead of deploying the wrong thing", async () => {
		mocks.assertApplicationAccess.mockResolvedValue({
			...baseRow,
			sourceType: "docker",
			dockerImage: "traefik/whoami:v1.10.1",
		});
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await expect(caller.deploy({ applicationId: "app-1", ref: "v1.2.0" })).rejects.toThrow(
			/no git ref to deploy/,
		);
		expect(mocks.queueDeployment).not.toHaveBeenCalled();
	});

	it("rejects a ref that could reach git's option parser", async () => {
		mocks.assertApplicationAccess.mockResolvedValue({
			...baseRow,
			sourceType: "github" as const,
			owner: "acme",
			repository: "web",
		});
		const caller = applicationRouter.createCaller(ctxFor({ id: "sess-1", token: "t" }));
		await expect(
			caller.deploy({ applicationId: "app-1", ref: "--upload-pack=evil" }),
		).rejects.toThrow();
		expect(mocks.queueDeployment).not.toHaveBeenCalled();
	});

	it("records an API-key caller as an api deploy by the key owner", async () => {
		mocks.assertApplicationAccess.mockResolvedValue({
			...baseRow,
			sourceType: "github",
			owner: "acme",
			repository: "web",
		});
		const caller = applicationRouter.createCaller(ctxFor({ id: "api-key_k1", token: "api-key" }));
		await caller.redeploy({ applicationId: "app-1" });
		expect(mocks.queueDeployment).toHaveBeenCalledWith({
			applicationId: "app-1",
			type: "redeploy",
			trigger: "api",
			triggeredBy: "user-1",
		});
	});
});
