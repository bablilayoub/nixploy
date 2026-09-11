import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `setServiceTags` replaces a tag set with a DELETE followed by an INSERT.
 * These tests pin the ordering and — the point of the exercise — that both
 * statements run inside one transaction, so a crash between them cannot drop
 * every tag off the service.
 */

/** Statements the fake executor saw, in order. */
const calls: string[] = [];

/** Tags `db.query.tags.findMany` answers the ownership check with. */
let ownedTags: Array<{ tagId: string }> = [];

/** Minimal drizzle-shaped transaction handle: records instead of querying. */
const tx = {
	delete: () => ({
		where: async () => {
			calls.push("delete");
		},
	}),
	insert: () => ({
		values: async (rows: unknown[]) => {
			calls.push(`insert:${rows.length}`);
		},
	}),
};

const fakeDb = {
	query: { tags: { findMany: async () => ownedTags } },
	async transaction<T>(run: (handle: typeof tx) => Promise<T>): Promise<T> {
		calls.push("begin");
		const result = await run(tx);
		calls.push("commit");
		return result;
	},
};

vi.mock("../../db", () => ({ db: fakeDb }));

const { SERVICE_REGISTRY } = await import("../services/registry");
const { setServiceTags } = await import("./index");

const tenancy = (organizationId: string) => ({
	serviceId: "svc_1",
	name: "svc",
	appName: "svc-abc123",
	serverId: null,
	environmentId: "env_1",
	organizationId,
});

describe("setServiceTags", () => {
	beforeEach(() => {
		calls.length = 0;
		ownedTags = [];
		vi.restoreAllMocks();
	});

	it("runs the delete and the insert inside one transaction", async () => {
		vi.spyOn(SERVICE_REGISTRY.postgres.module, "findTenancy").mockResolvedValue(tenancy("org_1"));
		ownedTags = [{ tagId: "tag_1" }, { tagId: "tag_2" }];

		const result = await setServiceTags("org_1", "postgres", "svc_1", ["tag_1", "tag_2"]);

		expect(calls).toEqual(["begin", "delete", "insert:2", "commit"]);
		expect(result).toEqual({ type: "postgres", serviceId: "svc_1", tagIds: ["tag_1", "tag_2"] });
	});

	it("still wraps the clear-all case", async () => {
		vi.spyOn(SERVICE_REGISTRY.application.module, "findTenancy").mockResolvedValue(
			tenancy("org_1"),
		);

		await setServiceTags("org_1", "application", "svc_1", []);

		expect(calls).toEqual(["begin", "delete", "commit"]);
	});

	it("writes nothing when the service belongs to another organization", async () => {
		vi.spyOn(SERVICE_REGISTRY.compose.module, "findTenancy").mockResolvedValue(tenancy("org_2"));

		await expect(setServiceTags("org_1", "compose", "svc_1", ["tag_1"])).rejects.toThrow(
			/Service not found/,
		);
		expect(calls).toEqual([]);
	});

	it("writes nothing when the service does not exist", async () => {
		vi.spyOn(SERVICE_REGISTRY.redis.module, "findTenancy").mockResolvedValue(undefined);

		await expect(setServiceTags("org_1", "redis", "svc_1", [])).rejects.toThrow(
			/Service not found/,
		);
		expect(calls).toEqual([]);
	});

	it("writes nothing when a tag belongs to another organization", async () => {
		vi.spyOn(SERVICE_REGISTRY.mysql.module, "findTenancy").mockResolvedValue(tenancy("org_1"));
		// Only one of the two requested tags is owned by the org.
		ownedTags = [{ tagId: "tag_1" }];

		await expect(setServiceTags("org_1", "mysql", "svc_1", ["tag_1", "other_org"])).rejects.toThrow(
			/One or more tags are invalid/,
		);
		expect(calls).toEqual([]);
	});
});
