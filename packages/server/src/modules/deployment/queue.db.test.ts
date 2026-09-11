/**
 * Durable-queue suite against a real Postgres.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway database, migrated) and skips
 * when unset so the default offline run stays green — exactly like
 * `trpc/tenancy.test.ts`, whose fixtures this reuses. This is the only place
 * the claim statement's real semantics are exercised: `FOR UPDATE SKIP
 * LOCKED` under concurrency, the `NOT EXISTS` per-app mutex, the per-server
 * FIFO order and the coalescing UPDATE.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("durable deploy queue (postgres)", () => {
	type Harness = typeof import("../../trpc/tenancy.harness");
	type QueueModule = typeof import("./queue");
	type Db = typeof import("../../db");
	type Schema = typeof import("../../db/schema");

	let harness: Harness;
	let queue: QueueModule;
	let dbModule: Db;
	let schema: Schema;
	let tenant: TenantFixture;
	/** A second application in the same environment (per-app mutex tests). */
	let otherApplicationId: string;
	let appNameOne: string;
	let appNameTwo: string;
	/**
	 * Every row this suite inserts is pinned to the tenant's own server, and
	 * every claim asks for that server's line. The claim query is deliberately
	 * database-wide — a concurrent run of this same file (the test database is
	 * shared) would otherwise claim our rows and vice versa.
	 */
	let lineA: string;
	let lineB: string;

	const suffix = randomUUID().slice(0, 8);

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		if (!process.env.NIXPLOY_CONFIG_DIR) {
			process.env.NIXPLOY_CONFIG_DIR = await mkdtemp(join(tmpdir(), "nixploy-queue-"));
		}
		harness = await import("../../trpc/tenancy.harness");
		dbModule = await import("../../db");
		schema = await import("../../db/schema");
		queue = await import("./queue");
		// Never let the real worker claim anything in this process: `draining`
		// makes startQueueLoop() a no-op, so every claim below is explicit.
		await queue.drainQueue({ graceMs: 0 });

		tenant = await harness.seedOneTenant(`queue${suffix}`);
		const [ownApp] = await dbModule.db
			.select({ appName: schema.applications.appName })
			.from(schema.applications)
			.where(eq(schema.applications.applicationId, tenant.applicationId));
		appNameOne = ownApp?.appName ?? "";

		otherApplicationId = `queue_app_${suffix}`;
		appNameTwo = `queue-two-${suffix}`;
		await dbModule.db.insert(schema.applications).values({
			applicationId: otherApplicationId,
			name: "queue two",
			appName: appNameTwo,
			environmentId: tenant.environmentId,
		});

		lineA = tenant.serverId;
		const [second] = await dbModule.db
			.insert(schema.servers)
			.values({
				name: `queue-line-b-${suffix}`,
				ipAddress: "10.9.9.9",
				organizationId: tenant.organizationId,
			})
			.returning({ serverId: schema.servers.serverId });
		lineB = second?.serverId as string;

		// Pin both applications to line A so `queueDeployment` (which reads the
		// target server off the application row) lands in the isolated line too.
		await dbModule.db
			.update(schema.applications)
			.set({ serverId: lineA })
			.where(
				inArray(schema.applications.applicationId, [tenant.applicationId, otherApplicationId]),
			);
	}, 60_000);

	afterAll(async () => {
		if (tenant) await harness.wipeTenant(tenant);
	});

	const insertQueued = async (
		deploymentId: string,
		applicationId: string,
		createdAt: Date,
		serverId: string = lineA,
	): Promise<void> => {
		await dbModule.db.insert(schema.deployments).values({
			deploymentId,
			title: "Deployment",
			status: "queued",
			logPath: `/tmp/${deploymentId}.log`,
			applicationId,
			serverId,
			createdAt,
		});
	};

	const statusOf = async (deploymentId: string) => {
		const [row] = await dbModule.db
			.select({ status: schema.deployments.status, errorMessage: schema.deployments.errorMessage })
			.from(schema.deployments)
			.where(eq(schema.deployments.deploymentId, deploymentId));
		return row;
	};

	const wipeDeployments = async () => {
		await dbModule.db
			.delete(schema.deployments)
			.where(inArray(schema.deployments.applicationId, [tenant.applicationId, otherApplicationId]));
		// The test database is shared: another agent running the suite at the
		// same time can wipe rows underneath us. Re-assert the fixture instead
		// of failing with a confusing "row is not claimable".
		const [present] = await dbModule.db
			.select({ id: schema.applications.applicationId })
			.from(schema.applications)
			.where(eq(schema.applications.applicationId, otherApplicationId));
		if (!present) {
			await dbModule.db.insert(schema.applications).values({
				applicationId: otherApplicationId,
				name: "queue two",
				appName: appNameTwo,
				environmentId: tenant.environmentId,
				serverId: lineA,
			});
		}
	};

	beforeEach(wipeDeployments);

	it("claims the oldest queued row for a server and flips it to running", async () => {
		const base = Date.now();
		await insertQueued("q-old", tenant.applicationId, new Date(base - 2000));
		await insertQueued("q-new", otherApplicationId, new Date(base - 1000));

		const first = await queue.claimNextDeployment(lineA, []);
		expect(first?.deploymentId).toBe("q-old");
		expect(first?.appName).toBe(appNameOne);
		expect((await statusOf("q-old"))?.status).toBe("running");

		const second = await queue.claimNextDeployment(lineA, []);
		expect(second?.deploymentId).toBe("q-new");
		expect(second?.appName).toBe(appNameTwo);

		expect(await queue.claimNextDeployment(lineA, [])).toBeNull();
	});

	it("never hands the same row to two concurrent claimers (FOR UPDATE SKIP LOCKED)", async () => {
		const base = Date.now();
		await insertQueued("c-1", tenant.applicationId, new Date(base - 2000));
		await insertQueued("c-2", otherApplicationId, new Date(base - 1000));

		const [a, b] = await Promise.all([
			queue.claimNextDeployment(lineA, []),
			queue.claimNextDeployment(lineA, []),
		]);

		const claimed = [a?.deploymentId, b?.deploymentId].filter(Boolean).sort();
		expect(claimed).toEqual(["c-1", "c-2"]);
		expect(a?.deploymentId).not.toBe(b?.deploymentId);
	});

	it("refuses a second row for an app that is already running (per-app mutex)", async () => {
		const base = Date.now();
		await insertQueued("m-1", tenant.applicationId, new Date(base - 3000));
		await insertQueued("m-2", tenant.applicationId, new Date(base - 2000));
		await insertQueued("m-3", otherApplicationId, new Date(base - 1000));

		expect((await queue.claimNextDeployment(lineA, []))?.deploymentId).toBe("m-1");
		// m-2 is the oldest remaining row, but its app is building: m-3 wins.
		expect((await queue.claimNextDeployment(lineA, []))?.deploymentId).toBe("m-3");
		expect(await queue.claimNextDeployment(lineA, [])).toBeNull();

		// Once m-1 finishes, m-2 becomes claimable.
		await dbModule.db
			.update(schema.deployments)
			.set({ status: "done", finishedAt: new Date() })
			.where(eq(schema.deployments.deploymentId, "m-1"));
		expect((await queue.claimNextDeployment(lineA, []))?.deploymentId).toBe("m-2");
	});

	it("keeps each target server's line separate", async () => {
		const base = Date.now();
		await insertQueued("s-a", tenant.applicationId, new Date(base - 2000), lineA);
		await insertQueued("s-b", otherApplicationId, new Date(base - 1000), lineB);

		// The newer row is claimed first because it is first in ITS line.
		expect((await queue.claimNextDeployment(lineB, []))?.deploymentId).toBe("s-b");
		expect((await queue.claimNextDeployment(lineA, []))?.deploymentId).toBe("s-a");
	});

	it("skips the deployment ids the caller blocked", async () => {
		const base = Date.now();
		await insertQueued("b-1", tenant.applicationId, new Date(base - 2000));
		await insertQueued("b-2", otherApplicationId, new Date(base - 1000));

		expect((await queue.claimNextDeployment(lineA, ["b-1"]))?.deploymentId).toBe("b-2");
		expect((await statusOf("b-1"))?.status).toBe("queued");
	});

	it("computes 1-based queue positions per server from SQL", async () => {
		const base = Date.now();
		await insertQueued("p-1", tenant.applicationId, new Date(base - 3000), lineA);
		await insertQueued("p-2", otherApplicationId, new Date(base - 2000), lineA);
		await insertQueued("p-3", tenant.applicationId, new Date(base - 1000), lineB);

		await queue.refreshQueueSnapshot();
		expect(queue.getQueuePosition("p-1")).toBe(1);
		expect(queue.getQueuePosition("p-2")).toBe(2);
		expect(queue.getQueuePosition("p-3")).toBe(1); // its own server's line
		expect(queue.queueDepth(lineA).pending).toBe(2);
		expect(queue.queueDepth(lineB).pending).toBe(1);
	});

	it("supersedes the queued row of an app when a newer deploy is queued", async () => {
		const { queueDeployment, SUPERSEDED_MESSAGE } = await import("./index");
		const first = await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });
		const second = await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });

		expect(await statusOf(first)).toMatchObject({
			status: "cancelled",
			errorMessage: SUPERSEDED_MESSAGE,
		});
		expect((await statusOf(second))?.status).toBe("queued");

		// A row the worker already claimed is never superseded.
		const claimed = await queue.claimNextDeployment(lineA, []);
		expect(claimed?.deploymentId).toBe(second);
		const third = await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });
		expect((await statusOf(second))?.status).toBe("running");
		expect((await statusOf(third))?.status).toBe("queued");
	});

	it("leaves another app's queued row alone when coalescing", async () => {
		const { queueDeployment } = await import("./index");
		const other = await queueDeployment({ applicationId: otherApplicationId, type: "deploy" });
		const first = await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });
		await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });

		expect((await statusOf(other))?.status).toBe("queued");
		expect((await statusOf(first))?.status).toBe("cancelled");
	});
});
