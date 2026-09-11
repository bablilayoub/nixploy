/**
 * Compose rollback snapshots against a real Postgres.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway database); skips when unset so the
 * default run stays offline — same contract as `trpc/tenancy.test.ts`, and
 * `DATABASE_URL` is assigned before any dynamic import of `db`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

// Compose interpolation syntax under test, spelled without a literal `${…}`
// so Biome does not read it as a forgotten template string.
const IMAGE_PLACEHOLDER = ["$", "{IMAGE}"].join("");
const SOURCE_WITH_VARIABLE = `services:\n  web:\n    image: ${IMAGE_PLACEHOLDER}\n`;

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("compose deployment snapshots", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let dbModule: typeof import("../../db");
	let schema: typeof import("../../db/schema");
	let snapshot: typeof import("./snapshot");
	let drizzle: typeof import("drizzle-orm");
	let tenant: TenantFixture;

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		harness = await import("../../trpc/tenancy.harness");
		dbModule = await import("../../db");
		schema = await import("../../db/schema");
		snapshot = await import("./snapshot");
		drizzle = await import("drizzle-orm");
		tenant = await harness.seedOneTenant("snap");
	}, 60_000);

	afterAll(async () => {
		if (tenant) await harness.wipeTenant(tenant);
	});

	/** Insert a deployment row for the fixture's compose service. */
	const seedDeployment = async (
		status: "done" | "error" | "running",
		title = "Deployment",
	): Promise<string> => {
		const [row] = await dbModule.db
			.insert(schema.deployments)
			.values({
				title,
				status,
				logPath: `/tmp/snap-${Date.now()}-${Math.random()}.log`,
				composeId: tenant.composeId,
				appName: `snap-${Math.random().toString(16).slice(2, 8)}`,
				startedAt: new Date(),
				finishedAt: status === "running" ? null : new Date(),
			})
			.returning();
		if (!row) throw new Error("deployment seed failed");
		return row.deploymentId;
	};

	const wipeSnapshots = async () => {
		await dbModule.db
			.delete(schema.composeDeploymentSnapshots)
			.where(drizzle.eq(schema.composeDeploymentSnapshots.composeId, tenant.composeId));
		await dbModule.db
			.delete(schema.deployments)
			.where(drizzle.eq(schema.deployments.composeId, tenant.composeId));
	};

	it("persists the rendered file and both env blobs, encrypted at rest", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: SOURCE_WITH_VARIABLE,
			renderedFile: "services:\n  web:\n    image: traefik/whoami:v1\n",
			serviceEnv: "IMAGE=traefik/whoami:v1",
			mergedEnv: "SHARED=1\nIMAGE=traefik/whoami:v1",
		});

		const row = await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId);
		expect(row?.renderedFile).toContain("traefik/whoami:v1");
		expect(row?.serviceEnv).toBe("IMAGE=traefik/whoami:v1");
		expect(row?.mergedEnv).toContain("SHARED=1");

		// The columns are `encryptedText`: the ciphertext on disk must not be
		// the plaintext the query layer hands back.
		const [raw] = (await dbModule.db.execute(
			drizzle.sql`select "rendered_file", "merged_env" from "compose_deployment_snapshot" where "deployment_id" = ${deploymentId}`,
		)) as unknown as Array<{ rendered_file: string; merged_env: string }>;
		expect(raw?.rendered_file).not.toContain("traefik/whoami");
		expect(raw?.merged_env).not.toContain("SHARED=1");
	});

	it("keeps the first writer's snapshot when a second write races it", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: "first",
			renderedFile: "first-rendered",
			serviceEnv: "A=1",
			mergedEnv: "A=1",
		});
		// e.g. `compose.start` re-rendering while the worker owns the job.
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: "second",
			renderedFile: "second-rendered",
			serviceEnv: "A=2",
			mergedEnv: "A=2",
		});

		const row = await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId);
		expect(row?.renderedFile).toBe("first-rendered");
	});

	it("offers only snapshots whose deployment succeeded, newest first", async () => {
		await wipeSnapshots();
		const ok1 = await seedDeployment("done", "First");
		const failed = await seedDeployment("error", "Broken");
		const running = await seedDeployment("running", "In flight");
		const ok2 = await seedDeployment("done", "Second");
		for (const [index, deploymentId] of [ok1, failed, running, ok2].entries()) {
			await snapshot.recordComposeSnapshot({
				composeId: tenant.composeId,
				deploymentId,
				sourceFile: `source-${index}`,
				renderedFile: `rendered-${index}`,
				serviceEnv: `N=${index}`,
				mergedEnv: `N=${index}`,
			});
		}

		const targets = await snapshot.listComposeRollbackTargets(tenant.composeId);
		expect(targets.map((target) => target.deploymentId)).toEqual([ok2, ok1]);
		expect(targets[0]?.deployment?.title).toBe("Second");
	});

	it("prunes to the newest COMPOSE_SNAPSHOT_LIMIT rows", async () => {
		await wipeSnapshots();
		const keep = snapshot.COMPOSE_SNAPSHOT_LIMIT;
		const ids: string[] = [];
		for (let index = 0; index < keep + 3; index++) {
			const deploymentId = await seedDeployment("done");
			ids.push(deploymentId);
			await snapshot.recordComposeSnapshot({
				composeId: tenant.composeId,
				deploymentId,
				sourceFile: `source-${index}`,
				renderedFile: `rendered-${index}`,
				serviceEnv: null,
				mergedEnv: null,
			});
		}
		const targets = await snapshot.listComposeRollbackTargets(tenant.composeId);
		expect(targets).toHaveLength(keep);
		// The three oldest are gone.
		for (const gone of ids.slice(0, 3)) {
			expect(await snapshot.findComposeSnapshotByDeployment(tenant.composeId, gone)).toBeNull();
		}
	});

	it("never returns another compose service's snapshot", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: "mine",
			renderedFile: "mine-rendered",
			serviceEnv: null,
			mergedEnv: null,
		});
		const row = await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId);
		expect(row).not.toBeNull();
		// Same snapshot id, wrong compose service.
		expect(
			await snapshot.findComposeSnapshot("some-other-compose-id", row?.snapshotId ?? ""),
		).toBeNull();
	});

	it("restores the compose body and the SERVICE env, leaving inheritance intact", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: SOURCE_WITH_VARIABLE,
			renderedFile: "services:\n  web:\n    image: traefik/whoami:v1\n",
			serviceEnv: "IMAGE=traefik/whoami:v1",
			// Deliberately different: writing the MERGED env back would absorb
			// every inherited variable into the service row for good.
			mergedEnv: "SHARED=from-project\nIMAGE=traefik/whoami:v1",
		});
		const row = await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId);
		if (!row) throw new Error("snapshot missing");

		const result = await snapshot.restoreComposeSnapshot(
			{ composeId: tenant.composeId, sourceType: "raw" },
			row,
		);
		expect(result).toEqual({ restoredComposeFile: true, restoredEnv: true });

		const updated = await dbModule.db.query.compose.findFirst({
			where: drizzle.eq(schema.compose.composeId, tenant.composeId),
		});
		expect(updated?.composeFile).toContain(IMAGE_PLACEHOLDER);
		expect(updated?.env).toBe("IMAGE=traefik/whoami:v1");
		expect(updated?.env).not.toContain("SHARED=from-project");
	});

	it("restores only the env for a git-backed row (the repository stays the authority)", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await dbModule.db
			.update(schema.compose)
			.set({ composeFile: "from-the-repo" })
			.where(drizzle.eq(schema.compose.composeId, tenant.composeId));
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: "snapshot-body",
			renderedFile: "snapshot-rendered",
			serviceEnv: "FROM=snapshot",
			mergedEnv: "FROM=snapshot",
		});
		const row = await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId);
		if (!row) throw new Error("snapshot missing");

		const result = await snapshot.restoreComposeSnapshot(
			{ composeId: tenant.composeId, sourceType: "github" },
			row,
		);
		expect(result).toEqual({ restoredComposeFile: false, restoredEnv: true });

		const updated = await dbModule.db.query.compose.findFirst({
			where: drizzle.eq(schema.compose.composeId, tenant.composeId),
		});
		expect(updated?.composeFile).toBe("from-the-repo");
		expect(updated?.env).toBe("FROM=snapshot");
	});

	it("cascades with the deployment row", async () => {
		await wipeSnapshots();
		const deploymentId = await seedDeployment("done");
		await snapshot.recordComposeSnapshot({
			composeId: tenant.composeId,
			deploymentId,
			sourceFile: "x",
			renderedFile: "y",
			serviceEnv: null,
			mergedEnv: null,
		});
		await dbModule.db
			.delete(schema.deployments)
			.where(drizzle.eq(schema.deployments.deploymentId, deploymentId));
		expect(
			await snapshot.findComposeSnapshotByDeployment(tenant.composeId, deploymentId),
		).toBeNull();
	});
});
