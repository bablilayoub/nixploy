import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, syncPreviewTraefik, queueDeployment, upsertPreviewComment } = vi.hoisted(() => ({
	state: {
		parentDomain: null as null | { port: number | null; https: boolean; certificateType: string },
		/** Rows `domains.findMany` returns (the compose exposed-service lookup). */
		composeDomains: [] as Array<Record<string, unknown>>,
		inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
		/** Application row the module loads (preview knobs live on it). */
		application: {
			applicationId: "app-1",
			name: "echo",
			appName: "echo-4a4487",
			serverId: null as string | null,
			branch: "main" as string | null,
			gitBranch: null as string | null,
			isPreviewDeploymentsActive: true,
			previewForksRequireApproval: true,
			previewLimit: 3,
			previewTtlHours: null as number | null,
			sourceType: "github",
			owner: "acme",
			repository: "echo",
			githubId: "gh-1" as string | null,
			gitlabId: null as string | null,
			bitbucketId: null as string | null,
			giteaId: null as string | null,
		},
		/** Compose row the module loads for compose previews. */
		compose: {
			composeId: "cmp-1",
			name: "shop",
			appName: "shop-9f00aa",
			serverId: null as string | null,
			branch: "main" as string | null,
			gitBranch: null as string | null,
			isPreviewDeploymentsActive: true,
			previewForksRequireApproval: true,
			previewLimit: 3,
			previewTtlHours: null as number | null,
			sourceType: "github",
			owner: "acme",
			repository: "shop",
			githubId: "gh-1" as string | null,
			gitlabId: null as string | null,
			bitbucketId: null as string | null,
			giteaId: null as string | null,
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
			applications: { findFirst: async () => state.application },
			compose: { findFirst: async () => state.compose },
			previewDeployments: { findFirst: async () => undefined },
			domains: {
				findFirst: async () => state.parentDomain,
				findMany: async () => state.composeDomains,
			},
		},
		select: () => ({
			from: () => ({
				where: async () => [{ value: state.livePreviews }],
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
				returning: async () => {
					const rows = Array.isArray(values) ? values : [values];
					for (const row of rows) state.inserted.push({ table: tableName(table), values: row });
					return rows.map((row, index) => ({
						previewDeploymentId: "prev-1",
						domainId: `dom-${index + 1}`,
						...row,
					}));
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
// The per-preview database reaches the engines (dockerode, exec); this file
// tests the preview lifecycle, so it is a no-op here.
vi.mock("./database", () => ({
	ensurePreviewDatabase: vi.fn(async () => null),
	dropPreviewDatabase: vi.fn(async () => undefined),
	previewDatabaseEnv: vi.fn(async () => null),
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
vi.mock("./traefik", () => ({ syncPreviewTraefik, removePreviewTraefik: vi.fn(async () => {}) }));
vi.mock("./comment", () => ({ upsertPreviewComment }));

import { isReservedAppName } from "../../utils/validators";
import {
	classifyPullRequestAction,
	createPreviewDeployment,
	PreviewLimitError,
	PreviewNotFoundError,
	previewAppName,
	previewComposeHost,
	previewExpiryFromTtl,
	previewHost,
	previewKeyForRef,
	previewLimitReached,
	previewParentRef,
} from "./index";

describe("previewAppName / previewHost", () => {
	it("names a preview after its parent and pull request", () => {
		expect(previewAppName("echo-4a4487", "12")).toBe("echo-4a4487-pr-12");
		expect(previewHost("echo-4a4487", "12")).toBe("pr-12-echo-4a4487.example.test");
	});

	it("gives a compose preview its own project name and a host per service", () => {
		// The project name is what keeps the preview's containers, volumes,
		// `<appName>-net` and Traefik keys off production's.
		expect(previewAppName("shop-9f00aa", "7")).toBe("shop-9f00aa-pr-7");
		expect(previewComposeHost("shop-9f00aa", "7", "web")).toBe("pr-7-shop-9f00aa-web.example.test");
		expect(previewComposeHost("shop-9f00aa", "7", "api")).toBe("pr-7-shop-9f00aa-api.example.test");
		// Two services of one PR, and the same service across two PRs, never collide.
		expect(previewComposeHost("shop-9f00aa", "7", "web")).not.toBe(
			previewComposeHost("shop-9f00aa", "8", "web"),
		);
	});

	it("refuses a non-numeric pull request number", () => {
		expect(() => previewAppName("shop", "7; rm -rf /")).toThrow(/Invalid pull request number/);
		expect(() => previewComposeHost("shop", "../..", "web")).toThrow(/Invalid pull request number/);
		expect(() => previewAppName("shop", "bZZZZZZ")).toThrow(/Invalid pull request number/);
	});

	it("names a branch preview after a short hash of its ref", () => {
		const key = previewKeyForRef("feat/cart");
		expect(key).toMatch(/^b[0-9a-f]{6}$/);
		expect(previewKeyForRef("feat/cart ")).toBe(key);
		expect(previewKeyForRef("feat/cart-2")).not.toBe(key);
		expect(previewAppName("shop", key)).toBe(`shop-pr-${key}`);
		expect(previewHost("shop", key)).toMatch(new RegExp(`^pr-${key}-shop\\.`));
		expect(isReservedAppName(`shop-pr-${key}`)).toBe(true);
	});
});

describe("previewParentRef", () => {
	it("accepts exactly one parent id and rejects zero or two", () => {
		expect(previewParentRef({ applicationId: "app-1" })).toEqual({
			kind: "application",
			id: "app-1",
		});
		expect(previewParentRef({ composeId: "cmp-1" })).toEqual({ kind: "compose", id: "cmp-1" });
		expect(previewParentRef({})).toBeNull();
		expect(previewParentRef({ applicationId: "app-1", composeId: "cmp-1" })).toBeNull();
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

const reset = () => {
	state.inserted.length = 0;
	state.livePreviews = 0;
	state.composeDomains = [];
	state.application.previewLimit = 3;
	state.application.previewTtlHours = null;
	state.compose.previewLimit = 3;
	state.compose.previewTtlHours = null;
	syncPreviewTraefik.mockClear();
	queueDeployment.mockClear();
	upsertPreviewComment.mockClear();
};

describe("createPreviewDeployment (application)", () => {
	beforeEach(reset);

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
			expect.objectContaining({
				previewDeploymentId: "prev-1",
				type: "deploy",
				applicationId: "app-1",
				composeId: undefined,
			}),
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
			expect.objectContaining({
				applicationId: "app-1",
				pullRequestNumber: "14",
				status: "limit_reached",
			}),
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

const composeDomain = (
	serviceName: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	serviceName,
	protocol: "http",
	port: 80,
	https: false,
	certificateType: "none",
	certificateId: null,
	previewDeploymentId: null,
	...overrides,
});

describe("createPreviewDeployment (compose)", () => {
	beforeEach(reset);

	it("creates one preview domain per compose service exposed in production", async () => {
		state.composeDomains = [
			composeDomain("web", { port: 8080 }),
			composeDomain("api", { port: 3000, https: true, certificateType: "letsencrypt" }),
			// A second host for the same service must not create a second preview.
			composeDomain("web", { port: 8080 }),
		];
		const result = await createPreviewDeployment({
			composeId: "cmp-1",
			pullRequestNumber: "7",
		});

		const previewInsert = state.inserted.find((row) => row.table === "preview_deployment");
		expect(previewInsert?.values).toMatchObject({
			appName: "shop-9f00aa-pr-7",
			composeId: "cmp-1",
			applicationId: null,
		});

		const domainInserts = state.inserted.filter((row) => row.table === "domain");
		expect(domainInserts).toHaveLength(2);
		expect(domainInserts.map((row) => row.values.host)).toEqual([
			"pr-7-shop-9f00aa-web.example.test",
			"pr-7-shop-9f00aa-api.example.test",
		]);
		// Each preview route mirrors ITS service's production settings.
		expect(domainInserts[0]?.values).toMatchObject({
			serviceName: "web",
			port: 8080,
			https: false,
			composeId: "cmp-1",
			domainType: "preview",
			previewDeploymentId: "prev-1",
		});
		expect(domainInserts[1]?.values).toMatchObject({
			serviceName: "api",
			port: 3000,
			https: true,
			certificateType: "letsencrypt",
		});

		expect(syncPreviewTraefik).toHaveBeenCalledWith("prev-1");
		expect(queueDeployment).toHaveBeenCalledWith(
			expect.objectContaining({
				previewDeploymentId: "prev-1",
				composeId: "cmp-1",
				applicationId: undefined,
				type: "deploy",
			}),
		);
		expect(result.domains).toHaveLength(2);
	});

	it("skips tcp/udp domains — a wildcard host cannot express an entrypoint", async () => {
		state.composeDomains = [
			composeDomain("db", { protocol: "tcp", port: 5432 }),
			composeDomain("web"),
		];
		await createPreviewDeployment({ composeId: "cmp-1", pullRequestNumber: "8" });
		const domainInserts = state.inserted.filter((row) => row.table === "domain");
		expect(domainInserts.map((row) => row.values.serviceName)).toEqual(["web"]);
	});

	it("still deploys a stack whose services have no production domain", async () => {
		state.composeDomains = [];
		await createPreviewDeployment({ composeId: "cmp-1", pullRequestNumber: "9" });
		expect(state.inserted.filter((row) => row.table === "domain")).toHaveLength(0);
		expect(queueDeployment).toHaveBeenCalledWith(
			expect.objectContaining({ composeId: "cmp-1", previewDeploymentId: "prev-1" }),
		);
	});

	it("enforces the compose row's own preview cap", async () => {
		state.livePreviews = 3;
		state.compose.previewLimit = 3;
		await expect(
			createPreviewDeployment({ composeId: "cmp-1", pullRequestNumber: "10" }),
		).rejects.toBeInstanceOf(PreviewLimitError);
		expect(state.inserted).toHaveLength(0);
		expect(queueDeployment).not.toHaveBeenCalled();
		expect(upsertPreviewComment).toHaveBeenCalledWith(
			expect.objectContaining({ composeId: "cmp-1", status: "limit_reached" }),
		);
	});

	it("stamps the compose row's default TTL", async () => {
		state.compose.previewTtlHours = 12;
		await createPreviewDeployment({ composeId: "cmp-1", pullRequestNumber: "11" });
		const previewInsert = state.inserted.find((row) => row.table === "preview_deployment");
		const expiresAt = previewInsert?.values.expiresAt as Date;
		expect(expiresAt).toBeInstanceOf(Date);
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
	});

	it("refuses an input that names zero or two parents", async () => {
		await expect(createPreviewDeployment({ pullRequestNumber: "12" })).rejects.toBeInstanceOf(
			PreviewNotFoundError,
		);
		await expect(
			createPreviewDeployment({
				applicationId: "app-1",
				composeId: "cmp-1",
				pullRequestNumber: "12",
			}),
		).rejects.toBeInstanceOf(PreviewNotFoundError);
		expect(state.inserted).toHaveLength(0);
	});
});
