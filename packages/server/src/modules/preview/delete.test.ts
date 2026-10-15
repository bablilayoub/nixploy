import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, cancelDeployment, waitForDeployment } = vi.hoisted(() => ({
	state: {
		steps: [] as string[],
		settled: "cancelled",
	},
	cancelDeployment: vi.fn(async (id: string) => {
		state.steps.push(`cancel:${id}`);
	}),
	waitForDeployment: vi.fn(async (id: string) => {
		state.steps.push(`wait:${id}`);
		return { status: state.settled };
	}),
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			previewDeployments: {
				findFirst: async () => ({
					previewDeploymentId: "preview-1",
					appName: "app-pr-1",
					applicationId: "app-1",
					composeId: null,
					serverId: null,
				}),
			},
			deployments: {
				findMany: async () => [{ deploymentId: "queued-1" }, { deploymentId: "running-1" }],
			},
		},
		delete: () => ({ where: async () => state.steps.push("delete-row") }),
	},
}));
vi.mock("../deployment", () => ({ cancelDeployment, queueDeployment: vi.fn() }));
vi.mock("../deployment/outcome", () => ({ waitForDeployment }));
vi.mock("./database", () => ({
	dropPreviewDatabase: async () => state.steps.push("drop-database"),
	ensurePreviewDatabase: vi.fn(),
}));
vi.mock("./application", () => ({
	removePreviewApplicationFiles: async () => state.steps.push("remove-files"),
}));
vi.mock("./parent", () => ({ loadPreviewParent: async () => ({ serverId: null }) }));
vi.mock("./traefik", () => ({
	removePreviewTraefik: async () => state.steps.push("remove-route"),
	syncPreviewTraefik: vi.fn(),
}));
vi.mock("../application/docker", () => ({
	removeSwarmService: async () => state.steps.push("remove-service"),
	removeApplicationImages: async () => state.steps.push("remove-images"),
}));
vi.mock("./compose", () => ({
	listComposeExposedServices: vi.fn(),
	removePreviewComposeFiles: vi.fn(),
	teardownPreviewComposeProject: vi.fn(),
}));

import { deletePreviewDeployment } from "./index";

beforeEach(() => {
	state.steps = [];
	state.settled = "cancelled";
	vi.clearAllMocks();
});

describe("preview deletion", () => {
	it("stops queued and running jobs before deleting the preview's resources", async () => {
		await deletePreviewDeployment("preview-1");
		expect(state.steps).toEqual([
			"cancel:queued-1",
			"wait:queued-1",
			"cancel:running-1",
			"wait:running-1",
			"drop-database",
			"remove-service",
			"remove-images",
			"remove-files",
			"remove-route",
			"delete-row",
			"delete-row",
		]);
	});

	it("keeps resources available when cancellation has not settled", async () => {
		state.settled = "running";
		await expect(deletePreviewDeployment("preview-1")).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(state.steps).toEqual(["cancel:queued-1", "wait:queued-1"]);
	});
});
