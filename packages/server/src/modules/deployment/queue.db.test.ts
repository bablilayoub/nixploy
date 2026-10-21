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
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

	const deferred = () => {
		let resolve: () => void = () => {};
		let reject: (error: unknown) => void = () => {};
		const promise = new Promise<void>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		return { promise, resolve, reject };
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

	/** Failure evidence must survive cleanup, without exposing deployment inputs. */
	const failureSnapshot = async (testName: string) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const capture = dbModule.db.transaction(async (tx) => {
				await tx.execute(sql`set local statement_timeout = '750ms'`);
				await tx.execute(sql`set local lock_timeout = '250ms'`);
				const rows = await tx.execute(sql`
					select json_build_object(
						'database', current_database(), 'backendPid', pg_backend_pid(),
						'serverTime', clock_timestamp(),
						'deployments', (select coalesce(json_agg(d), '[]') from (
							select deployment_id, application_id, preview_deployment_id,
								server_id, app_name, status, created_at, started_at, finished_at
							from deployment where application_id in (${tenant.applicationId}, ${otherApplicationId})
								or app_name like ${`%${suffix}%`}
							order by created_at, deployment_id limit 50
						) d),
						'applications', (select coalesce(json_agg(a), '[]') from (
							select application_id, app_name, environment_id, server_id from application
							where application_id in (${tenant.applicationId}, ${otherApplicationId})
						) a),
						'activity', (select coalesce(json_agg(a), '[]') from (
							select pid, state, wait_event_type, wait_event, application_name,
								backend_start, xact_start from pg_stat_activity
							where datname = current_database()
							order by (state = 'active') desc, xact_start nulls last, pid limit 20
						) a),
						'locks', (select coalesce(json_agg(l), '[]') from (
							select l.pid, c.relname as relation, l.mode, l.granted from pg_locks l
							join pg_class c on c.oid = l.relation
							join pg_stat_activity a on a.pid = l.pid
							where a.datname = current_database()
								and c.oid in ('deployment'::regclass, 'application'::regclass)
							order by l.pid, c.relname, l.mode limit 50
						) l)
					) as snapshot
				`);
				return { status: "captured", snapshot: rows[0]?.snapshot };
			});
			const result = await Promise.race([
				capture.catch(() => ({ status: "unavailable" })),
				new Promise<{ status: "timeout" }>((resolve) => {
					timer = setTimeout(() => resolve({ status: "timeout" }), 1500);
				}),
			]);
			console.error(
				"QUEUE_FAILURE_DIAGNOSTIC",
				JSON.stringify({
					test: testName,
					nonce: suffix,
					nodePid: process.pid,
					clientTime: new Date().toISOString(),
					serverIds: [lineA, lineB],
					...result,
				}),
			);
		} catch {
			// Diagnostics must never replace the original assertion failure.
		} finally {
			if (timer) clearTimeout(timer);
		}
	};

	// Both ends: `beforeEach` so a test starts from a known line, `afterEach` so
	// the LAST test of the file does not leave a `running` row behind for the
	// next run of this same file.
	beforeEach(wipeDeployments);
	afterEach(async ({ task }) => {
		try {
			if (task.result?.state === "fail") {
				await failureSnapshot(task.name);
			}
		} finally {
			await wipeDeployments();
		}
	});

	it("claims the oldest queued row for a server and flips it to running", async () => {
		const base = Date.now();
		await insertQueued("q-old", tenant.applicationId, new Date(base - 2000));
		await insertQueued("q-new", otherApplicationId, new Date(base - 1000));

		const first = await queue.claimNextDeployment(lineA);
		expect(first?.deploymentId).toBe("q-old");
		expect(first?.appName).toBe(appNameOne);
		expect((await statusOf("q-old"))?.status).toBe("running");
		expect((await statusOf("q-new"))?.status).toBe("queued");

		const second = await queue.claimNextDeployment(lineA);
		expect(second?.deploymentId).toBe("q-new");
		expect(second?.appName).toBe(appNameTwo);

		expect(await queue.claimNextDeployment(lineA)).toBeNull();
	});

	it("changes only one row when stale statistics favor rescanning the candidate", async () => {
		await dbModule.db.transaction(async (tx) => {
			// Keep planner statistics local to this transaction: a one-row estimate
			// with two actual candidates selects the formerly unsafe nested loop.
			await tx.execute(
				sql`create temporary table deployment (like public.deployment including all) on commit drop`,
			);
			await tx.insert(schema.deployments).values({
				deploymentId: `plan-first-${suffix}`,
				status: "queued",
				logPath: "/tmp/queue-plan-first.log",
				appName: appNameOne,
				serverId: lineA,
				createdAt: new Date(Date.now() - 2000),
			});
			await tx.execute(sql`analyze pg_temp.deployment`);
			await tx.insert(schema.deployments).values({
				deploymentId: `plan-second-${suffix}`,
				status: "queued",
				logPath: "/tmp/queue-plan-second.log",
				appName: appNameTwo,
				serverId: lineA,
				createdAt: new Date(Date.now() - 1000),
			});

			const first = await dbModule.runWithDatabaseTransaction(tx, () =>
				queue.claimNextDeployment(lineA),
			);
			expect(first?.deploymentId).toBe(`plan-first-${suffix}`);
			const rows = await tx
				.select({ id: schema.deployments.deploymentId, status: schema.deployments.status })
				.from(schema.deployments)
				.orderBy(schema.deployments.createdAt);
			expect(rows).toEqual([
				{ id: `plan-first-${suffix}`, status: "running" },
				{ id: `plan-second-${suffix}`, status: "queued" },
			]);
		});
	});

	it.each(["same server", "different servers"])(
		"keeps an uncommitted same-app claim exclusive while another app can run (%s)",
		async (placement) => {
			const base = Date.now();
			const secondServer = placement === "same server" ? lineA : lineB;
			await insertQueued(`race-first-${suffix}`, tenant.applicationId, new Date(base - 3000));
			await insertQueued(`race-sibling-${suffix}`, tenant.applicationId, new Date(base - 2000), {
				serverId: secondServer,
			});
			await insertQueued(`race-other-${suffix}`, otherApplicationId, new Date(base - 1000), {
				serverId: secondServer,
			});

			let release: () => void = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			let ready: (job: Awaited<ReturnType<QueueModule["claimNextDeployment"]>>) => void = () => {};
			let failed: (error: unknown) => void = () => {};
			const claimed = new Promise<Awaited<ReturnType<QueueModule["claimNextDeployment"]>>>(
				(resolve, reject) => {
					ready = resolve;
					failed = reject;
				},
			);
			const firstTransaction = dbModule.db.transaction((tx) =>
				dbModule.runWithDatabaseTransaction(tx, async () => {
					ready(await queue.claimNextDeployment(lineA));
					await held;
				}),
			);
			void firstTransaction.catch(failed);
			try {
				expect((await claimed)?.deploymentId).toBe(`race-first-${suffix}`);
				expect((await queue.claimNextDeployment(secondServer))?.deploymentId).toBe(
					`race-other-${suffix}`,
				);
				expect((await statusOf(`race-sibling-${suffix}`))?.status).toBe("queued");
			} finally {
				release();
				await firstTransaction;
			}
			expect(await queue.claimNextDeployment(secondServer)).toBeNull();
		},
	);

	it.each(["read committed", "repeatable read"] as const)(
		"uses a fresh statement snapshot when a first claim commits between selection and app lock (default %s)",
		async (defaultIsolation) => {
			const base = Date.now();
			const firstId = `window-first-${suffix}`;
			const siblingId = `window-sibling-${suffix}`;
			const otherId = `window-other-${suffix}`;
			await insertQueued(firstId, tenant.applicationId, new Date(base - 3000));
			await insertQueued(siblingId, tenant.applicationId, new Date(base - 2000));
			await insertQueued(otherId, otherApplicationId, new Date(base - 1000));

			// This client changes only its own session default, never the shared
			// database/role. Ordinary queue transactions must override that default.
			const connection = postgres(testUrl as string, {
				max: 1,
				prepare: false,
				connection: { default_transaction_isolation: defaultIsolation },
			});
			const claimDb = drizzle(connection, { schema });
			const dialect = new PgDialect();
			const firstReady = deferred();
			const firstRelease = deferred();
			const selected = deferred();
			const secondRelease = deferred();
			const stages: string[] = [];
			let firstSelection = true;
			let firstAppLock = true;
			type Transaction = Parameters<Parameters<typeof claimDb.transaction>[0]>[0];
			const intercept = (tx: Transaction) =>
				new Proxy(tx, {
					get(transaction, property) {
						if (property === "execute") {
							return async (query: Parameters<typeof tx.execute>[0]) => {
								const text =
									typeof query === "string" ? query : dialect.sqlToQuery(query.getSQL()).sql;
								const result = await transaction.execute(query);
								if (firstSelection && text.includes('select q."deployment_id", q."app_name"')) {
									firstSelection = false;
									expect(result[0]).toMatchObject({ deployment_id: siblingId });
									stages.push("second-selected-sibling");
									selected.resolve();
									await secondRelease.promise;
								} else if (firstAppLock && text.includes("pg_try_advisory_xact_lock")) {
									firstAppLock = false;
									expect(stages.at(-1)).toBe("first-committed");
									expect(result[0]).toMatchObject({ acquired: true });
									stages.push("second-acquired-sibling-lock");
								}
								return result;
							};
						}
						const value = Reflect.get(transaction, property);
						return typeof value === "function" ? value.bind(transaction) : value;
					},
				});
			const intercepted = new Proxy(claimDb, {
				get(target, property) {
					if (property === "transaction") {
						return (...[callback, config]: Parameters<typeof claimDb.transaction>) =>
							target.transaction((tx) => callback(intercept(tx)), config);
					}
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			let secondClaim: ReturnType<QueueModule["claimNextDeployment"]> | undefined;
			const firstClaim = dbModule.db.transaction((tx) =>
				dbModule.runWithDatabaseTransaction(tx, async () => {
					expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe(firstId);
					stages.push("first-updated-uncommitted");
					firstReady.resolve();
					await firstRelease.promise;
				}),
			);
			void firstClaim.catch(firstReady.reject);
			try {
				expect((await connection`show default_transaction_isolation`)[0]).toMatchObject({
					default_transaction_isolation: defaultIsolation,
				});
				await firstReady.promise;
				secondClaim = dbModule.runWithDatabaseTransaction(intercepted, () =>
					queue.claimNextDeployment(lineA),
				);
				void secondClaim.catch(selected.reject);
				await selected.promise;
				firstRelease.resolve();
				await firstClaim;
				stages.push("first-committed");
				expect((await statusOf(firstId))?.status).toBe("running");
				secondRelease.resolve();
				expect((await secondClaim)?.deploymentId).toBe(otherId);
				expect((await statusOf(siblingId))?.status).toBe("queued");
				expect((await statusOf(otherId))?.status).toBe("running");
				expect(stages).toEqual([
					"first-updated-uncommitted",
					"second-selected-sibling",
					"first-committed",
					"second-acquired-sibling-lock",
				]);
			} finally {
				firstRelease.resolve();
				secondRelease.resolve();
				await Promise.allSettled([firstClaim, secondClaim]);
				await connection.end();
			}
		},
	);

	it.each(["repeatable read", "serializable"] as const)(
		"rejects an inherited %s transaction before protocol or row changes",
		async (isolationLevel) => {
			const id = `nested-isolation-${suffix}`;
			await insertQueued(id, tenant.applicationId, new Date());
			await dbModule.db.transaction(
				async (tx) => {
					await tx.execute(sql`set local nixploy.environment_snapshot_protocol = '0'`);
					await expect(
						dbModule.runWithDatabaseTransaction(tx, () => queue.claimNextDeployment(lineA)),
					).rejects.toThrow("READ COMMITTED");
					const [protocol] = await tx.execute(
						sql`select current_setting('nixploy.environment_snapshot_protocol', true) as value`,
					);
					expect(protocol?.value).toBe("0");
					const rows = await tx
						.select({ status: schema.deployments.status, startedAt: schema.deployments.startedAt })
						.from(schema.deployments)
						.where(eq(schema.deployments.deploymentId, id));
					expect(rows).toEqual([{ status: "queued", startedAt: null }]);
				},
				{ isolationLevel },
			);
			expect((await statusOf(id))?.status).toBe("queued");
		},
	);

	it("does not deadlock against an enqueue holding the app lock or orphan its replacement", async () => {
		const { queueDeployment } = await import("./index");
		const base = Date.now();
		await insertQueued(`enqueue-old-${suffix}`, tenant.applicationId, new Date(base - 2000));
		await insertQueued(`enqueue-other-${suffix}`, otherApplicationId, new Date(base - 1000));
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let ready: () => void = () => {};
		let failed: (error: unknown) => void = () => {};
		const locked = new Promise<void>((resolve, reject) => {
			ready = resolve;
			failed = reject;
		});
		const enqueue = dbModule.db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${appNameOne}))`);
			ready();
			await held;
			return queueDeployment(
				{ applicationId: tenant.applicationId, type: "deploy" },
				{ executor: tx, notices: [] },
			);
		});
		void enqueue.catch(failed);
		let replacement: string;
		try {
			await locked;
			expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe(
				`enqueue-other-${suffix}`,
			);
			expect((await statusOf(`enqueue-old-${suffix}`))?.status).toBe("queued");
		} finally {
			release();
			replacement = await enqueue;
		}
		expect((await statusOf(`enqueue-old-${suffix}`))?.status).toBe("cancelled");
		expect((await statusOf(replacement))?.status).toBe("queued");
		expect((await queue.claimNextDeployment(lineA))?.deploymentId).toBe(replacement);
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
