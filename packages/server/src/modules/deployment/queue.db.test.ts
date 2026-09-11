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
import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
		// Delete this suite's rows BEFORE the tenant: a deployment row whose
		// application is gone keeps a non-null `app_name` and a `queued`/
		// `running` status, and the claim query and the per-app mutex are
		// database-wide. One aborted run used to be enough to leave a row that
		// no later run could ever claim past.
		await wipeDeployments().catch(() => {});
		if (tenant) await harness.wipeTenant(tenant);
	});

	/**
	 * Insert a queued row the way `queueDeployment` does — `app_name` included,
	 * because since migration 0023 that column IS the queue's key (a NULL row
	 * is deliberately unclaimable).
	 */
	const insertQueued = async (
		deploymentId: string,
		applicationId: string,
		createdAt: Date,
		options: { serverId?: string; appName?: string | null; previewDeploymentId?: string } = {},
	): Promise<void> => {
		const appName =
			options.appName === undefined
				? applicationId === tenant.applicationId
					? appNameOne
					: appNameTwo
				: options.appName;
		await dbModule.db.insert(schema.deployments).values({
			deploymentId,
			title: "Deployment",
			status: "queued",
			logPath: `/tmp/${deploymentId}.log`,
			applicationId,
			appName,
			isPreview: Boolean(options.previewDeploymentId),
			previewDeploymentId: options.previewDeploymentId ?? null,
			serverId: options.serverId ?? lineA,
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

	/**
	 * Remove everything this suite created, and nothing else.
	 *
	 * `nixploy_test` is shared and long-lived, so "the tests passed once" is not
	 * enough — they have to pass against a database this file already ran
	 * against. Two kinds of leftover used to break that:
	 *
	 * - a row still `running` (every claim test leaves one) holds the per-app
	 *   mutex, which is a database-wide `NOT EXISTS` on `app_name`;
	 * - a row whose `application_id` was nulled or whose fixture is gone is not
	 *   matched by an `application_id` filter at all.
	 *
	 * Deleting by `app_name` as well as by application covers both: every name
	 * this suite uses carries the run's random suffix (`appNameOne`,
	 * `appNameTwo` and the `-pr-<n>` previews derived from them), so the LIKE
	 * can never reach a concurrent run's rows.
	 */
	const wipeDeployments = async () => {
		await dbModule.db
			.delete(schema.deployments)
			.where(
				or(
					inArray(schema.deployments.applicationId, [tenant.applicationId, otherApplicationId]),
					like(schema.deployments.appName, `%${suffix}%`),
				),
			);
		await dbModule.db
			.delete(schema.previewDeployments)
			.where(like(schema.previewDeployments.appName, `%${suffix}%`));
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

	// Both ends: `beforeEach` so a test starts from a known line, `afterEach` so
	// the LAST test of the file does not leave a `running` row behind for the
	// next run of this same file.
	beforeEach(wipeDeployments);
	afterEach(wipeDeployments);

	it("claims the oldest queued row for a server and flips it to running", async () => {
		const base = Date.now();
		await insertQueued("q-old", tenant.applicationId, new Date(base - 2000));
		await insertQueued("q-new", otherApplicationId, new Date(base - 1000));

		const first = await queue.claimNextDeployment(lineA);
		expect(first?.deploymentId).toBe("q-old");
		expect(first?.appName).toBe(appNameOne);
		expect((await statusOf("q-old"))?.status).toBe("running");

		const second = await queue.claimNextDeployment(lineA);
		expect(second?.deploymentId).toBe("q-new");
		expect(second?.appName).toBe(appNameTwo);

		expect(await queue.claimNextDeployment(lineA)).toBeNull();
	});

	it("never hands the same row to two concurrent claimers (FOR UPDATE SKIP LOCKED)", async () => {
		const base = Date.now();
		await insertQueued("c-1", tenant.applicationId, new Date(base - 2000));
		await insertQueued("c-2", otherApplicationId, new Date(base - 1000));

		const [a, b] = await Promise.all([
			queue.claimNextDeployment(lineA),
			queue.claimNextDeployment(lineA),
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

		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("m-1");
		// m-2 is the oldest remaining row, but its app is building: m-3 wins.
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("m-3");
		expect(await queue.claimNextDeployment(lineA)).toBeNull();

		// Once m-1 finishes, m-2 becomes claimable.
		await dbModule.db
			.update(schema.deployments)
			.set({ status: "done", finishedAt: new Date() })
			.where(eq(schema.deployments.deploymentId, "m-1"));
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("m-2");
	});

	it("keeps each target server's line separate", async () => {
		const base = Date.now();
		await insertQueued("s-a", tenant.applicationId, new Date(base - 2000), { serverId: lineA });
		await insertQueued("s-b", otherApplicationId, new Date(base - 1000), { serverId: lineB });

		// The newer row is claimed first because it is first in ITS line.
		expect((await queue.claimNextDeployment(lineB))?.deploymentId).toBe("s-b");
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("s-a");
	});

	it("never claims a row without an app_name (the orphan guard)", async () => {
		const base = Date.now();
		await insertQueued("b-1", tenant.applicationId, new Date(base - 2000), { appName: null });
		await insertQueued("b-2", otherApplicationId, new Date(base - 1000));

		// b-1 is older but unplaceable — boot recovery finalizes rows like it.
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("b-2");
		expect(await queue.claimNextDeployment(lineA)).toBeNull();
		expect((await statusOf("b-1"))?.status).toBe("queued");
	});

	it("treats a preview as its own app: its own mutex, its own coalescing line", async () => {
		const base = Date.now();
		const previewApp = `${appNameOne}-pr-7`;
		// Both PR rows carry the PARENT applicationId, exactly like a real preview.
		await insertQueued("pr-1", tenant.applicationId, new Date(base - 3000), {
			appName: previewApp,
		});
		await insertQueued("pr-2", tenant.applicationId, new Date(base - 2000), {
			appName: previewApp,
		});
		await insertQueued("pr-prod", tenant.applicationId, new Date(base - 1000));

		const first = await queue.claimNextDeployment(lineA);
		expect(first?.deploymentId).toBe("pr-1");
		expect(first?.appName).toBe(previewApp);

		// The PARENT is a different app_name, so it is NOT blocked by the PR build…
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe("pr-prod");
		// …while the PR's own sibling waits on the mutex.
		expect(await queue.claimNextDeployment(lineA)).toBeNull();
		expect((await statusOf("pr-2"))?.status).toBe("queued");
	});

	it("computes 1-based queue positions per server from SQL", async () => {
		const base = Date.now();
		await insertQueued("p-1", tenant.applicationId, new Date(base - 3000), { serverId: lineA });
		await insertQueued("p-2", otherApplicationId, new Date(base - 2000), { serverId: lineA });
		await insertQueued("p-3", tenant.applicationId, new Date(base - 1000), { serverId: lineB });

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
		const claimed = await queue.claimNextDeployment(lineA);
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

	it("records app_name + preview id on enqueue and coalesces previews per PR", async () => {
		const { queueDeployment } = await import("./index");
		const previewId = `queue_prev_${suffix}`;
		const previewApp = `${appNameOne}-pr-9`;
		await dbModule.db.insert(schema.previewDeployments).values({
			previewDeploymentId: previewId,
			appName: previewApp,
			applicationId: tenant.applicationId,
			serverId: lineA,
		});

		const parent = await queueDeployment({ applicationId: tenant.applicationId, type: "deploy" });
		const firstPr = await queueDeployment({
			applicationId: tenant.applicationId,
			previewDeploymentId: previewId,
			type: "deploy",
		});
		const secondPr = await queueDeployment({
			applicationId: tenant.applicationId,
			previewDeploymentId: previewId,
			type: "redeploy",
		});

		// The PR's own line coalesced; the parent application's row is untouched.
		expect((await statusOf(firstPr))?.status).toBe("cancelled");
		expect((await statusOf(parent))?.status).toBe("queued");

		const [row] = await dbModule.db
			.select({
				appName: schema.deployments.appName,
				previewDeploymentId: schema.deployments.previewDeploymentId,
				isPreview: schema.deployments.isPreview,
			})
			.from(schema.deployments)
			.where(eq(schema.deployments.deploymentId, secondPr));
		expect(row).toEqual({
			appName: previewApp,
			previewDeploymentId: previewId,
			isPreview: true,
		});

		// And the claim hands the worker the preview job back, rebuilt from SQL
		// alone — which is what makes a queued preview survive a restart. The
		// parent row is older, so it goes first; the PR is a different app and
		// follows immediately.
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe(parent);
		const claimed = await queue.claimNextDeployment(lineA);
		expect(claimed).toMatchObject({
			deploymentId: secondPr,
			appName: previewApp,
			previewDeploymentId: previewId,
			type: "redeploy",
		});
	});
});
