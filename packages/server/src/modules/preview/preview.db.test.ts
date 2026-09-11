/**
 * Compose previews against a real Postgres: the one-parent CHECK constraint
 * migration 0028 adds, the cascade from the compose row, and the deploy job a
 * compose preview enqueues.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway database); skips when unset so the
 * default run stays offline — same contract as `trpc/tenancy.test.ts`, and
 * `DATABASE_URL` is assigned before any dynamic import of `db`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("preview deployments (postgres)", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let dbModule: typeof import("../../db");
	let schema: typeof import("../../db/schema");
	let drizzle: typeof import("drizzle-orm");
	let tenant: TenantFixture;

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		harness = await import("../../trpc/tenancy.harness");
		dbModule = await import("../../db");
		schema = await import("../../db/schema");
		drizzle = await import("drizzle-orm");
		tenant = await harness.seedOneTenant("prev");
	}, 60_000);

	afterAll(async () => {
		if (tenant) await harness.wipeTenant(tenant);
	});

	const insertPreview = async (values: Record<string, unknown>) =>
		await dbModule.db
			.insert(schema.previewDeployments)
			.values({
				appName: `prev-${Math.random().toString(16).slice(2, 8)}`,
				pullRequestNumber: "7",
				...values,
			} as typeof schema.previewDeployments.$inferInsert)
			.returning();

	it("accepts a preview that names exactly one parent", async () => {
		const [fromApplication] = await insertPreview({ applicationId: tenant.applicationId });
		expect(fromApplication?.composeId).toBeNull();
		const [fromCompose] = await insertPreview({ composeId: tenant.composeId });
		expect(fromCompose?.applicationId).toBeNull();
		expect(fromCompose?.composeId).toBe(tenant.composeId);

		await dbModule.db
			.delete(schema.previewDeployments)
			.where(
				drizzle.inArray(schema.previewDeployments.previewDeploymentId, [
					fromApplication?.previewDeploymentId ?? "",
					fromCompose?.previewDeploymentId ?? "",
				]),
			);
	});

	/** Postgres reports the constraint on the driver error, not in drizzle's message. */
	const violatedConstraint = async (insert: Promise<unknown>): Promise<string | undefined> => {
		try {
			await insert;
			return undefined;
		} catch (error) {
			return (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
		}
	};

	it("refuses a preview with two parents or none (preview_deployment_one_parent)", async () => {
		expect(
			await violatedConstraint(
				insertPreview({ applicationId: tenant.applicationId, composeId: tenant.composeId }),
			),
		).toBe("preview_deployment_one_parent");
		expect(await violatedConstraint(insertPreview({}))).toBe("preview_deployment_one_parent");
	});

	it("cascades a compose preview (and its domains) with the compose row", async () => {
		// A compose service of its own, so deleting it cannot disturb the fixture.
		const [row] = await dbModule.db
			.insert(schema.compose)
			.values({
				name: "cascade",
				appName: `cascade-${Math.random().toString(16).slice(2, 8)}`,
				environmentId: tenant.environmentId,
			})
			.returning();
		const composeId = row?.composeId as string;
		const [preview] = await insertPreview({ composeId });
		const previewDeploymentId = preview?.previewDeploymentId as string;
		await dbModule.db.insert(schema.domains).values({
			host: `pr-7-cascade-${Math.random().toString(16).slice(2, 8)}.example.test`,
			path: "/",
			serviceName: "web",
			domainType: "preview",
			composeId,
			previewDeploymentId,
		});

		await dbModule.db.delete(schema.compose).where(drizzle.eq(schema.compose.composeId, composeId));

		expect(
			await dbModule.db.query.previewDeployments.findFirst({
				where: drizzle.eq(schema.previewDeployments.previewDeploymentId, previewDeploymentId),
			}),
		).toBeUndefined();
		expect(
			await dbModule.db.query.domains.findFirst({
				where: drizzle.eq(schema.domains.previewDeploymentId, previewDeploymentId),
			}),
		).toBeUndefined();
	});

	it("queues a compose preview job under the preview's own app_name", async () => {
		const { queueDeployment } = await import("../deployment");
		const [preview] = await insertPreview({
			composeId: tenant.composeId,
			appName: `qp-${Math.random().toString(16).slice(2, 8)}-pr-7`,
		});
		const previewDeploymentId = preview?.previewDeploymentId as string;

		const deploymentId = await queueDeployment({
			composeId: tenant.composeId,
			previewDeploymentId,
			type: "deploy",
			trigger: "preview",
		});
		const deployment = await dbModule.db.query.deployments.findFirst({
			where: drizzle.eq(schema.deployments.deploymentId, deploymentId),
		});
		// The row targets the compose service but coalesces and locks under the
		// PREVIEW name — production's line is untouched.
		expect(deployment?.composeId).toBe(tenant.composeId);
		expect(deployment?.applicationId).toBeNull();
		expect(deployment?.appName).toBe(preview?.appName);
		expect(deployment?.isPreview).toBe(true);
		expect(deployment?.previewDeploymentId).toBe(previewDeploymentId);

		await dbModule.db
			.delete(schema.deployments)
			.where(drizzle.eq(schema.deployments.deploymentId, deploymentId));
		await dbModule.db
			.delete(schema.previewDeployments)
			.where(drizzle.eq(schema.previewDeployments.previewDeploymentId, previewDeploymentId));
	});
});
