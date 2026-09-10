import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, syncPreviewTraefik, queueDeployment } = vi.hoisted(() => ({
	state: {
		parentDomain: null as null | { port: number | null; https: boolean; certificateType: string },
		inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
	},
	syncPreviewTraefik: vi.fn(async () => {}),
	queueDeployment: vi.fn(async () => "dep-1"),
}));

const tableName = (table: unknown): string =>
	String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");

vi.mock("../../db", () => ({
	db: {
		query: {
			applications: {
				findFirst: async () => ({
					applicationId: "app-1",
					appName: "echo-4a4487",
					serverId: null,
					branch: "main",
					gitBranch: null,
				}),
			},
			previewDeployments: { findFirst: async () => undefined },
			domains: { findFirst: async () => state.parentDomain },
		},
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => ({
				returning: async () => {
					state.inserted.push({ table: tableName(table), values });
					return [{ previewDeploymentId: "prev-1", domainId: "dom-1", ...values }];
				},
			}),
		}),
		update: () => ({ set: () => ({ where: async () => [] }) }),
	},
}));
vi.mock("../deployment", () => ({ queueDeployment }));
vi.mock("../application/paths", () => ({
	getWildcardDomain: () => "example.test",
}));
vi.mock("../application/docker", () => ({
	removeSwarmService: vi.fn(),
	removeApplicationImages: vi.fn(),
}));
vi.mock("../traefik", () => ({
	writeAppTraefikConfig: vi.fn(),
	removeTraefikConfig: vi.fn(),
	DEFAULT_CONTAINER_PORT: 80,
}));
vi.mock("./traefik", () => ({ syncPreviewTraefik }));

import {
	classifyPullRequestAction,
	createPreviewDeployment,
	previewAppName,
	previewHost,
} from "./index";

describe("previewAppName / previewHost", () => {
	it("uses the Dokploy-style variant naming", () => {
		expect(previewAppName("echo-4a4487", "12")).toBe("echo-4a4487-pr-12");
		expect(previewHost("echo-4a4487", "12")).toBe("pr-12-echo-4a4487.example.test");
	});
});

describe("classifyPullRequestAction", () => {
	it("maps provider actions to upsert or delete", () => {
		expect(classifyPullRequestAction("opened")).toBe("upsert");
		expect(classifyPullRequestAction("synchronize")).toBe("upsert");
		expect(classifyPullRequestAction("closed")).toBe("delete");
		expect(classifyPullRequestAction("fulfilled")).toBe("delete");
		expect(classifyPullRequestAction("ready_for_review")).toBe("ignore");
	});
});

describe("createPreviewDeployment", () => {
	beforeEach(() => {
		state.inserted.length = 0;
		syncPreviewTraefik.mockClear();
		queueDeployment.mockClear();
	});

	it("copies the parent domain's container port onto the preview domain row", async () => {
		state.parentDomain = { port: 8080, https: false, certificateType: "none" };
		const result = await createPreviewDeployment({
			applicationId: "app-1",
			pullRequestNumber: "12",
		});

		const domainInsert = state.inserted.find((row) => row.table === "domain");
		expect(domainInsert?.values).toMatchObject({
			host: "pr-12-echo-4a4487.example.test",
			port: 8080,
			domainType: "preview",
			previewDeploymentId: "prev-1",
		});
		// Route + parent's basic-auth/redirects come from the preview's own sync.
		expect(syncPreviewTraefik).toHaveBeenCalledWith("prev-1");
		expect(queueDeployment).toHaveBeenCalledWith(
			expect.objectContaining({ previewDeploymentId: "prev-1", type: "deploy" }),
		);
		expect(result.deploymentId).toBe("dep-1");
	});

	it("leaves the port null (shared default at write time) when the parent has none", async () => {
		state.parentDomain = null;
		await createPreviewDeployment({ applicationId: "app-1", pullRequestNumber: "13" });
		const domainInsert = state.inserted.find((row) => row.table === "domain");
		expect(domainInsert?.values.port).toBeNull();
	});
});
