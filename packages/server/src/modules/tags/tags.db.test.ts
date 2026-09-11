/**
 * Transaction behaviour of `setServiceTags` against a real Postgres.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway database); skips when unset so the
 * default run stays offline — same contract as `trpc/tenancy.test.ts`, and
 * `DATABASE_URL` is assigned before any dynamic import of `db`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("setServiceTags atomicity", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let dbModule: typeof import("../../db");
	let tagsModule: typeof import("./index");
	let registry: typeof import("../services/registry");
	let tenant: TenantFixture;
	let tagIds: string[];

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		harness = await import("../../trpc/tenancy.harness");
		dbModule = await import("../../db");
		tagsModule = await import("./index");
		registry = await import("../services/registry");
		tenant = await harness.seedOneTenant("tags");
		const created = await Promise.all([
			tagsModule.createTag(tenant.organizationId, { name: "alpha" }),
			tagsModule.createTag(tenant.organizationId, { name: "beta" }),
		]);
		tagIds = created.map((tag) => {
			if (!tag) throw new Error("tag seed failed");
			return tag.tagId;
		});
	}, 60_000);

	afterAll(async () => {
		if (tenant) await harness.wipeTenant(tenant);
	});

	const currentTagIds = async (): Promise<string[]> => {
		const rows = await registry.SERVICE_REGISTRY.postgres.module.listTagAssignments(
			tenant.organizationId,
			[tenant.postgresId],
		);
		return rows.map((row) => row.tagId).sort();
	};

	it("replaces the tag set", async () => {
		await tagsModule.setServiceTags(tenant.organizationId, "postgres", tenant.postgresId, tagIds);
		expect(await currentTagIds()).toEqual([...tagIds].sort());

		const [first] = tagIds;
		await tagsModule.setServiceTags(tenant.organizationId, "postgres", tenant.postgresId, [
			first as string,
		]);
		expect(await currentTagIds()).toEqual([first]);
	});

	it("rolls the delete back with the caller's transaction", async () => {
		await tagsModule.setServiceTags(tenant.organizationId, "postgres", tenant.postgresId, tagIds);
		const before = await currentTagIds();
		expect(before).toEqual([...tagIds].sort());

		// The write helper takes the caller's executor, so a later failure in
		// the same transaction must undo the delete + insert — not leave the
		// service with no tags at all.
		await expect(
			dbModule.db.transaction(async (tx) => {
				await tagsModule.setServiceTags(
					tenant.organizationId,
					"postgres",
					tenant.postgresId,
					[],
					tx,
				);
				throw new Error("boom");
			}),
		).rejects.toThrow(/boom/);

		expect(await currentTagIds()).toEqual(before);
	});
});
