import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, syncPreviewTraefik, queueDeployment, upsertPreviewComment } = vi.hoisted(() => ({
	state: {
		parentDomain: null as null | { port: number | null; https: boolean; certificateType: string },
		inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
		/** Application row the module loads (preview knobs live on it). */
		application: {
			applicationId: "app-1",
			name: "echo",
			appName: "echo-4a4487",
			serverId: null as string | null,
			branch: "main" as string | null,
			gitBranch: null as string | null,
			previewLimit: 3,
			previewTtlHours: null as number | null,
		},
		/** Rows `select(count())` reports for the preview cap. */
		livePreviews: 0,
	},
	syncPreviewTraefik: vi.fn(async () => {}),
	queueDeployment: vi.fn(async () => "dep-1"),
	upsertPreviewComment: vi.fn(async () => true),
}));

const tableName = (table: unknown): string =>
	String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");

vi.mock("../../db", () => ({
	db: {
		query: {
			applications: {
				findFirst: async () => state.application,
			},
			previewDeployments: { findFirst: async () => undefined },
			domains: { findFirst: async () => state.parentDomain },
		},
		select: () => ({
			from: () => ({
				where: async () => [{ value: state.livePreviews }],
			}),
		}),
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
vi.mock("./comment", () => ({ upsertPreviewComment }));

import {
	classifyPullRequestAction,
	createPreviewDeployment,
	PreviewLimitError,
	previewAppName,
	previewExpiryFromTtl,
	previewHost,
	previewLimitReached,
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

describe("previewLimitReached", () => {
	it("treats a null or non-positive limit as unlimited", () => {
		expect(previewLimitReached(99, null)).toBe(false);
		expect(previewLimitReached(99, 0)).toBe(false);
	});

	it("refuses once the cap is already filled", () => {
		expect(previewLimitReached(2, 3)).toBe(false);
		expect(previewLimitReached(3, 3)).toBe(true);
		expect(previewLimitReached(4, 3)).toBe(true);
	});
});

describe("previewExpiryFromTtl", () => {
	it("returns null without a TTL and now + hours with one", () => {
		const now = new Date("2026-01-01T00:00:00Z");
		expect(previewExpiryFromTtl(null, now)).toBeNull();
		expect(previewExpiryFromTtl(0, now)).toBeNull();
		expect(previewExpiryFromTtl(48, now)?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
	});
});

describe("createPreviewDeployment", () => {
	beforeEach(() => {
		state.inserted.length = 0;
		state.livePreviews = 0;
		state.application.previewLimit = 3;
		state.application.previewTtlHours = null;
		syncPreviewTraefik.mockClear();
		queueDeployment.mockClear();
		upsertPreviewComment.mockClear();
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

	it("refuses a preview over the application's cap and tells the pull request why", async () => {
		state.parentDomain = null;
		state.livePreviews = 3;
		await expect(
			createPreviewDeployment({ applicationId: "app-1", pullRequestNumber: "14" }),
		).rejects.toBeInstanceOf(PreviewLimitError);
		// Nothing was created and nothing was built.
		expect(state.inserted).toHaveLength(0);
		expect(queueDeployment).not.toHaveBeenCalled();
		expect(upsertPreviewComment).toHaveBeenCalledWith(
			expect.objectContaining({ pullRequestNumber: "14", status: "limit_reached" }),
		);
	});

	it("stamps the default TTL on a webhook-created preview", async () => {
		state.parentDomain = null;
		state.application.previewTtlHours = 24;
		await createPreviewDeployment({ applicationId: "app-1", pullRequestNumber: "15" });
		const previewInsert = state.inserted.find((row) => row.table === "preview_deployment");
		const expiresAt = previewInsert?.values.expiresAt as Date;
		expect(expiresAt).toBeInstanceOf(Date);
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
	});

	it("lets an explicit expiry win over the default TTL", async () => {
		state.parentDomain = null;
		state.application.previewTtlHours = 24;
		const explicit = new Date("2030-01-01T00:00:00Z");
		await createPreviewDeployment({
			applicationId: "app-1",
			pullRequestNumber: "16",
			expiresAt: explicit,
		});
		const previewInsert = state.inserted.find((row) => row.table === "preview_deployment");
		expect(previewInsert?.values.expiresAt).toBe(explicit);
	});
});
