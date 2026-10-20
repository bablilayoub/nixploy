import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFilter } from "../../modules/projects/project-scope";
import { fakeTRPCContext } from "../../test-utils/fake-session";

const mocks = vi.hoisted(() => ({
	deployment: vi.fn(),
	application: vi.fn(),
	compose: vi.fn(),
	context: vi.fn(() => {
		throw new Error("Hidden service context was accessed");
	}),
	cache: vi.fn(),
	saveApplication: vi.fn(async () => {}),
	saveCompose: vi.fn(async () => {}),
	queue: vi.fn(),
	filter: { kind: "projects", projectIds: new Set(["visible"]) } as ProjectFilter,
}));
vi.mock("../../db", async (original) => ({
	...(await original<typeof import("../../db")>()),
	db: {
		query: {
			deployments: { findFirst: mocks.deployment },
			applications: { findFirst: mocks.application },
			compose: { findFirst: mocks.compose },
		},
		select: mocks.context,
	},
}));
vi.mock("../../modules/projects", async (original) => ({
	...(await original<typeof import("../../modules/projects")>()),
	resolveCallerOrganizationId: vi.fn(async () => "org-1"),
	assertCapability: vi.fn(async () => {}),
}));
vi.mock("../../modules/projects/project-scope", async (original) => ({
	...(await original<typeof import("../../modules/projects/project-scope")>()),
	resolveProjectFilterForSession: vi.fn(async () => mocks.filter),
}));
vi.mock("../../modules/auth/two-factor-gate", () => ({
	isTwoFactorGateBlocked: async () => false,
}));
vi.mock("../../modules/auth/sso-gate", () => ({ isSsoGateBlocked: async () => false }));
vi.mock("../../modules/ai/settings", () => ({ getAiSettings: async () => ({ enabled: true }) }));
vi.mock("../../modules/ai/explanation-cache", () => ({
	readCachedExplanation: mocks.cache,
	writeCachedExplanation: vi.fn(),
}));
vi.mock("../../modules/application/service", async (original) => ({
	...(await original<typeof import("../../modules/application/service")>()),
	saveEnvironment: mocks.saveApplication,
}));
vi.mock("../../modules/compose/service", async (original) => ({
	...(await original<typeof import("../../modules/compose/service")>()),
	saveEnvironment: mocks.saveCompose,
}));
vi.mock("../../modules/deployment", async (original) => ({
	...(await original<typeof import("../../modules/deployment")>()),
	queueDeployment: mocks.queue,
}));

import { applySuggestedEnvPatch } from "../../modules/ai/apply-suggested";
import { chatAboutService, explainDeploymentFailure } from "../../modules/ai/explain";
import { runWithProjectFilter } from "../../modules/projects/project-scope";
import { aiRouter } from "./ai";

const service = (projectId = "hidden") => ({
	applicationId: "app-1",
	composeId: "compose-1",
	env: "KEEP=old",
	environment: { projectId, project: { organizationId: "org-1" } },
});
const cached = { summary: "private deployment explanation", suggestedPatch: "KEY=value" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.filter = { kind: "projects", projectIds: new Set(["visible"]) };
	mocks.deployment.mockResolvedValue({
		deploymentId: "dep-1",
		application: service(),
		compose: null,
		logPath: "/private/deploy.log",
	});
	mocks.application.mockResolvedValue(service());
	mocks.compose.mockResolvedValue(service());
	mocks.cache.mockResolvedValue(cached);
});

describe("Copilot project boundaries", () => {
	it.each(["application", "compose"] as const)(
		"hides cached %s explanations on both router paths",
		async (kind) => {
			mocks.deployment.mockResolvedValue({
				deploymentId: "dep-1",
				logPath: "/private/deploy.log",
				application: kind === "application" ? service() : null,
				compose: kind === "compose" ? service() : null,
			});
			const caller = aiRouter.createCaller(fakeTRPCContext());
			await expect(caller.getExplanation({ deploymentId: "dep-1" })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			await expect(caller.explainDeployment({ deploymentId: "dep-1" })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			expect(mocks.cache).not.toHaveBeenCalled();
		},
	);
	it("retains visible cached explanations", async () => {
		mocks.deployment.mockResolvedValue({
			application: service("visible"),
			logPath: "/private/deploy.log",
		});
		const caller = aiRouter.createCaller(fakeTRPCContext());
		expect(await caller.getExplanation({ deploymentId: "dep-1" })).toEqual(cached);
		expect(await caller.explainDeployment({ deploymentId: "dep-1" })).toEqual(cached);
	});
	it.each(["application", "compose"] as const)(
		"blocks hidden %s chat before collecting context",
		async (kind) => {
			const target =
				kind === "application"
					? { type: kind, applicationId: "app-1" }
					: { type: kind, composeId: "compose-1" };
			await expect(
				runWithProjectFilter(mocks.filter, () => chatAboutService(target, "org-1", [])),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect(mocks.context).not.toHaveBeenCalled();
		},
	);
	it("blocks fresh hidden explanations before reading logs or calling the model", async () => {
		await expect(
			runWithProjectFilter(mocks.filter, () => explainDeploymentFailure("dep-1", "org-1")),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it.each(["application", "compose"] as const)(
		"blocks hidden %s environment patches before cache or writes",
		async (kind) => {
			mocks.deployment.mockResolvedValue({
				application: kind === "application" ? service() : null,
				compose: kind === "compose" ? service() : null,
				logPath: "/private/deploy.log",
			});
			await expect(
				runWithProjectFilter(mocks.filter, () =>
					applySuggestedEnvPatch({ deploymentId: "dep-1", organizationId: "org-1" }),
				),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect(mocks.cache).not.toHaveBeenCalled();
			expect(mocks.saveApplication).not.toHaveBeenCalled();
			expect(mocks.saveCompose).not.toHaveBeenCalled();
			expect(mocks.queue).not.toHaveBeenCalled();
		},
	);
	it("retains visible patches without forcing a redeploy", async () => {
		mocks.deployment.mockResolvedValue({ application: service("visible"), compose: null });
		expect(
			await runWithProjectFilter(mocks.filter, () =>
				applySuggestedEnvPatch({
					deploymentId: "dep-1",
					organizationId: "org-1",
					patch: "KEY=value",
					redeploy: false,
				}),
			),
		).toEqual({ appliedKeys: ["KEY"], deploymentId: null });
		expect(mocks.saveApplication).toHaveBeenCalledWith("app-1", "KEEP=old\nKEY=value");
	});
});
