import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const infrastructure = vi.hoisted(() => ({
	inspect: vi.fn(async (_origin: unknown) => ({ serviceExists: false, volumeExists: false })),
	remove: vi.fn(async () => {}),
	volume: vi.fn(async () => {}),
}));
vi.mock("./recovery-copy-identity", async (original) => ({
	...(await original<typeof import("./recovery-copy-identity")>()),
	inspectRecoveryRuntime: infrastructure.inspect,
	removeOriginalRecoveryVolume: infrastructure.volume,
}));
vi.mock("../databases/engine", async (original) => ({
	...(await original<typeof import("../databases/engine")>()),
	removeDatabase: infrastructure.remove,
}));

describe.skipIf(!process.env.DATABASE_URL_TEST)(
	"durable recovery-copy inventory (postgres)",
	() => {
		let db: typeof import("../../db")["db"];
		let schema: typeof import("../../db/schema");
		let orm: typeof import("drizzle-orm");
		let harness: typeof import("../../trpc/tenancy.harness");
		let a: TenantFixture;
		let b: TenantFixture;
		const postgresIds: string[] = [];
		const scopedMembers: Awaited<ReturnType<typeof harness.seedTeamScopedMember>>[] = [];

		beforeAll(async () => {
			process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
			vi.stubEnv("DOCKER_HOST", "unix:///nonexistent-inventory-test.sock");
			({ db } = await import("../../db"));
			schema = await import("../../db/schema");
			orm = await import("drizzle-orm");
			harness = await import("../../trpc/tenancy.harness");
			({ a, b } = await harness.seedTwoTenants());
		}, 60_000);

		const clearCopies = async () => {
			await db
				.delete(schema.recoveryCopies)
				.where(
					orm.inArray(schema.recoveryCopies.organizationId, [a.organizationId, b.organizationId]),
				);
		};
		beforeEach(() => {
			vi.clearAllMocks();
			infrastructure.inspect.mockResolvedValue({ serviceExists: false, volumeExists: false });
		});
		afterEach(async () => {
			vi.restoreAllMocks();
			// These fixtures deliberately exercise restrictive tracking FKs. Only
			// their own tracking is removed before their metadata-only teardown.
			await clearCopies();
			await db
				.delete(schema.backups)
				.where(orm.inArray(schema.backups.destinationId, [a.destinationId, b.destinationId]));
			await db
				.update(schema.postgres)
				.set({ environmentId: a.environmentId })
				.where(orm.eq(schema.postgres.postgresId, a.postgresId));
			if (postgresIds.length) {
				await db
					.delete(schema.postgres)
					.where(orm.inArray(schema.postgres.postgresId, postgresIds));
				postgresIds.length = 0;
			}
			for (const scoped of scopedMembers.splice(0)) await harness.wipeTeamScopedMember(scoped);
		});
		afterAll(async () => {
			if (a && b) await clearCopies();
			if (a) await harness.wipeTenant(a);
			if (b) await harness.wipeTenant(b);
			vi.unstubAllEnvs();
		});

		const seedPostgres = async (environmentId = a.environmentId) => {
			const [row] = await db
				.insert(schema.postgres)
				.values({
					name: "Inventory target",
					appName: `inventory-${randomUUID().slice(0, 8)}`,
					databaseName: "inventory",
					databaseUser: "inventory",
					databasePassword: "test-only-password",
					environmentId,
					serverId: null,
				})
				.returning();
			if (!row) throw new Error("Inventory target missing");
			postgresIds.push(row.postgresId);
			return row;
		};
		const seedBackup = async (postgresId = a.postgresId) => {
			const [row] = await db
				.insert(schema.backups)
				.values({
					appName: "inventory",
					schedule: "0 3 * * *",
					enabled: false,
					prefix: "inventory",
					database: "inventory",
					databaseType: "postgres",
					postgresId,
					destinationId: a.destinationId,
				})
				.returning();
			if (!row) throw new Error("Inventory schedule missing");
			return row;
		};
		const seedCopy = async (values: Partial<typeof schema.recoveryCopies.$inferInsert> = {}) => {
			const target = values.targetPostgresId === undefined ? await seedPostgres() : null;
			const appName = target?.appName ?? `inventory-orphan-${randomUUID().slice(0, 8)}`;
			const [row] = await db
				.insert(schema.recoveryCopies)
				.values({
					organizationId: a.organizationId,
					requestId: randomUUID(),
					sourcePostgresId: a.postgresId,
					environmentId: a.environmentId,
					name: "Inventory copy",
					objectKey: "inventory/owned.gz",
					status: "ready",
					deadline: new Date(Date.now() + 60_000),
					originServerId: null,
					originSwarmNodeId: "a".repeat(25),
					originAppName: appName,
					originVolumeName: `${appName}-data`,
					originVolumeCreatedAt: "2026-10-21T00:00:00Z",
					...values,
					targetPostgresId:
						values.targetPostgresId === undefined
							? (target?.postgresId ?? null)
							: values.targetPostgresId,
				})
				.returning();
			if (!row) throw new Error("Inventory copy missing");
			return row;
		};
		const teamMember = async () => {
			const scoped = await harness.seedTeamScopedMember(a);
			scopedMembers.push(scoped);
			return scoped;
		};
		const copyIds = (rows: { recoveryCopyId: string }[]) => rows.map((row) => row.recoveryCopyId);

		it("keeps a scheduled copy reachable by source, target and project after deleting its schedule", async () => {
			const backup = await seedBackup();
			const copy = await seedCopy({ backupId: backup.backupId });
			const caller = harness.createTestCaller(a.session);
			expect(copyIds(await caller.backup.copies({ backupId: backup.backupId }))).toEqual([
				copy.recoveryCopyId,
			]);
			await caller.backup.remove({ backupId: backup.backupId });
			expect(
				await db.query.recoveryCopies.findFirst({
					where: orm.eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId),
				}),
			).toMatchObject({ backupId: null, status: "ready" });
			await expect(caller.backup.copies({ backupId: backup.backupId })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			for (const input of [
				{ postgresId: a.postgresId },
				{ postgresId: copy.targetPostgresId as string },
				{ projectId: a.projectId },
			]) {
				const page = await caller.backup.copyInventory(input);
				expect(page.nextCursor).toBeNull();
				expect(page.items).toHaveLength(1);
				expect(page.items[0]).toMatchObject({
					recoveryCopyId: copy.recoveryCopyId,
					projectId: a.projectId,
					status: "ready",
				});
				expect(page.items[0]).not.toHaveProperty("cursorCreatedAt");
				expect(copyIds(await caller.backup.copies(input))).toEqual([copy.recoveryCopyId]);
			}
			await caller.backup.deleteCopy({ recoveryCopyId: copy.recoveryCopyId });
			expect(infrastructure.inspect).toHaveBeenCalledTimes(2);
			expect(infrastructure.remove).not.toHaveBeenCalled();
			expect(
				await db.query.postgres.findFirst({
					where: orm.eq(schema.postgres.postgresId, copy.targetPostgresId as string),
				}),
			).toBeUndefined();
			expect(
				await db.query.postgres.findFirst({
					where: orm.eq(schema.postgres.postgresId, a.postgresId),
				}),
			).toBeDefined();
			expect(
				(await caller.backup.copyInventory({ projectId: a.projectId })).items[0],
			).toMatchObject({ status: "deleted", targetPostgresId: null });
		});

		it.each(["source", "target", "both"] as const)(
			"retains inventory with missing %s service metadata and verifies explicit deletion",
			async (missing) => {
				const copy = await seedCopy({
					...(missing !== "target" ? { sourcePostgresId: null } : {}),
					...(missing !== "source" ? { targetPostgresId: null } : {}),
				});
				const caller = harness.createTestCaller(a.session);
				const page = await caller.backup.copyInventory({ projectId: a.projectId });
				expect(page.items).toHaveLength(1);
				expect(page.items[0]).toMatchObject({
					recoveryCopyId: copy.recoveryCopyId,
					status: missing === "source" ? "ready" : "interrupted",
				});
				await caller.backup.deleteCopy({ recoveryCopyId: copy.recoveryCopyId });
				expect(infrastructure.inspect).toHaveBeenCalledTimes(2);
				expect(
					(await caller.backup.copyInventory({ projectId: a.projectId })).items[0]?.status,
				).toBe("deleted");
			},
		);

		it("finds the same copy through its recorded project and a moved target's current project", async () => {
			const scoped = await teamMember();
			const target = await seedPostgres(scoped.otherEnvironmentId);
			const copy = await seedCopy({ targetPostgresId: target.postgresId });
			const caller = harness.createTestCaller(a.session);
			for (const projectId of [a.projectId, scoped.otherProjectId]) {
				expect((await caller.backup.copyInventory({ projectId })).items[0]).toMatchObject({
					recoveryCopyId: copy.recoveryCopyId,
					projectId: scoped.otherProjectId,
					targetEnvironmentName: "production",
				});
			}
		});

		it.each(["origin", "source", "target", "backup source"] as const)(
			"filters a freshly hidden %s project on every inventory request",
			async (axis) => {
				const scoped = await teamMember();
				const hidden = await seedPostgres(scoped.otherEnvironmentId);
				const backup = await seedBackup();
				const copy = await seedCopy({
					backupId: axis === "backup source" ? backup.backupId : null,
				});
				const caller = harness.createTestCaller(scoped.session);
				expect(
					copyIds((await caller.backup.copyInventory({ projectId: a.projectId })).items),
				).toEqual([copy.recoveryCopyId]);
				if (axis === "origin")
					await db
						.update(schema.recoveryCopies)
						.set({ environmentId: scoped.otherEnvironmentId })
						.where(orm.eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
				else if (axis === "backup source")
					await db
						.update(schema.backups)
						.set({ postgresId: hidden.postgresId })
						.where(orm.eq(schema.backups.backupId, backup.backupId));
				else
					await db
						.update(schema.postgres)
						.set({ environmentId: scoped.otherEnvironmentId })
						.where(
							orm.eq(
								schema.postgres.postgresId,
								axis === "source" ? a.postgresId : (copy.targetPostgresId as string),
							),
						);
				const owner = harness.createTestCaller(a.session);
				expect(
					copyIds((await owner.backup.copyInventory({ projectId: a.projectId })).items),
				).toEqual([copy.recoveryCopyId]);
				expect((await caller.backup.copyInventory({ projectId: a.projectId })).items).toEqual([]);
				expect(await caller.backup.copies({ projectId: a.projectId })).toEqual([]);
				await expect(
					caller.backup.copyInventory({ projectId: scoped.otherProjectId }),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
				await expect(
					caller.backup.deleteCopy({ recoveryCopyId: copy.recoveryCopyId }),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
				expect(infrastructure.inspect).not.toHaveBeenCalled();
			},
		);

		it.each(["origin", "source", "target"] as const)(
			"hides cross-organization %s links and rejects foreign filter IDs",
			async (axis) => {
				await seedCopy({
					environmentId: axis === "origin" ? b.environmentId : a.environmentId,
					sourcePostgresId: axis === "source" ? b.postgresId : a.postgresId,
					targetPostgresId: axis === "target" ? b.postgresId : undefined,
				});
				const caller = harness.createTestCaller(a.session);
				expect((await caller.backup.copyInventory({ projectId: a.projectId })).items).toEqual([]);
				for (const input of [{ projectId: b.projectId }, { postgresId: b.postgresId }]) {
					await expect(caller.backup.copyInventory(input)).rejects.toMatchObject({
						code: "NOT_FOUND",
					});
					await expect(caller.backup.copies(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
				}
			},
		);

		it("keeps source authorization independent of a still-accessible backup during listing and deletion", async () => {
			const scoped = await teamMember();
			const hiddenSource = await seedPostgres(scoped.otherEnvironmentId);
			const backup = await seedBackup();
			const copy = await seedCopy({
				backupId: backup.backupId,
				sourcePostgresId: hiddenSource.postgresId,
			});
			const caller = harness.createTestCaller(scoped.session);
			expect(await caller.backup.one({ backupId: backup.backupId })).toMatchObject({
				backupId: backup.backupId,
			});
			expect(await caller.backup.copies({ backupId: backup.backupId })).toEqual([]);
			expect((await caller.backup.copyInventory({ projectId: a.projectId })).items).toEqual([]);
			await expect(
				caller.backup.deleteCopy({ recoveryCopyId: copy.recoveryCopyId }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect(infrastructure.inspect).not.toHaveBeenCalled();
		});

		it("filters hidden history before the page cutoff so an older retained copy is visible", async () => {
			const scoped = await teamMember();
			const hidden = await seedPostgres(scoped.otherEnvironmentId);
			const visible = await seedCopy({ targetPostgresId: null, createdAt: new Date(1) });
			await db.insert(schema.recoveryCopies).values(
				Array.from({ length: 110 }, (_, index) => ({
					organizationId: a.organizationId,
					requestId: randomUUID(),
					sourcePostgresId: hidden.postgresId,
					environmentId: a.environmentId,
					name: `Hidden ${index}`,
					objectKey: "inventory/hidden.gz",
					status: "deleted",
					deadline: new Date(),
				})),
			);
			const page = await harness
				.createTestCaller(scoped.session)
				.backup.copyInventory({ projectId: a.projectId });
			expect(copyIds(page.items)).toEqual([visible.recoveryCopyId]);
			expect(page.nextCursor).toBeNull();
		});

		it("pages every ID once across microseconds and identical timestamp ties, including older retained data", async () => {
			const nonce = randomUUID();
			const rows = Array.from({ length: 105 }, (_, index) => ({
				recoveryCopyId: `inventory-${nonce}-${String(index).padStart(3, "0")}`,
				organizationId: a.organizationId,
				requestId: randomUUID(),
				sourcePostgresId: a.postgresId,
				environmentId: a.environmentId,
				name: `History ${index}`,
				objectKey: "inventory/history.gz",
				status: index === 0 ? "ready" : "deleted",
				deadline: new Date(),
			}));
			await db.insert(schema.recoveryCopies).values(rows);
			const exact = rows.map(
				(row, index) =>
					orm.sql`(${row.recoveryCopyId}, ${`2026-10-21T00:00:00.000${String(Math.min(index, 102)).padStart(3, "0")}Z`}::timestamptz)`,
			);
			await db.execute(
				orm.sql`update recovery_copy r set created_at = v.created_at from (values ${orm.sql.join(exact, orm.sql`, `)}) v(id, created_at) where r.recovery_copy_id = v.id`,
			);
			const caller = harness.createTestCaller(a.session);
			const first = await caller.backup.copyInventory({ projectId: a.projectId });
			expect(first.items).toHaveLength(100);
			expect(first.nextCursor?.createdAt).toMatch(/\.\d{6}Z$/);
			expect(first.nextCursor?.createdAt).toBe("2026-10-21T00:00:00.000005Z");
			expect(first.items.every((row) => !Object.hasOwn(row, "cursorCreatedAt"))).toBe(true);
			if (!first.nextCursor) throw new Error("Inventory cursor missing");
			const second = await caller.backup.copyInventory({
				projectId: a.projectId,
				cursor: first.nextCursor,
			});
			expect(second.nextCursor).toBeNull();
			expect(second.items).toHaveLength(5);
			const ids = [...copyIds(first.items), ...copyIds(second.items)];
			expect(ids).toEqual(rows.map((row) => row.recoveryCopyId).reverse());
			expect(new Set(ids).size).toBe(105);
			expect(second.items.at(-1)).toMatchObject({
				recoveryCopyId: rows[0]?.recoveryCopyId,
				status: "interrupted",
			});
			expect(copyIds(await caller.backup.copies({ projectId: a.projectId }))).toEqual(
				copyIds(first.items),
			);
		});

		it("propagates unexpected database errors rather than returning an empty inventory", async () => {
			await seedCopy();
			vi.spyOn(db.query.environments, "findFirst").mockRejectedValueOnce(
				new Error("inventory lookup unavailable"),
			);
			await expect(
				harness.createTestCaller(a.session).backup.copyInventory({ projectId: a.projectId }),
			).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		});
	},
);
