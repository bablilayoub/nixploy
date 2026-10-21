import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const transport = vi.hoisted(() => ({
	deploy: vi.fn(async () => ({ created: true })),
	node: vi.fn(async () => "a".repeat(25)),
	identity: vi.fn(),
	provision: vi.fn(async (_origin: unknown) => "2026-10-20T12:00:00Z"),
	orphanRemove: vi.fn(async (_origin: unknown) => {}),
	replay: vi.fn(async () => {}),
	remove: vi.fn(async () => {}),
	exists: vi.fn(async (_appName: string) => false),
	query: vi.fn(async (_command: string, input: string) =>
		input.startsWith("SELECT 1") ? "1\n" : "2\n",
	),
	volume: vi.fn(async (_command: string, _options?: { timeout: number }) => ""),
	remoteVolume: vi.fn(
		async (_serverId: string, _command: string, _options?: { timeoutMs: number }) => "",
	),
	root: "",
}));
vi.mock("../databases/engine", async (original) => ({
	...(await original<typeof import("../databases/engine")>()),
	deployDatabase: transport.deploy,
	removeDatabase: transport.remove,
	databaseServiceExists: transport.exists,
}));
vi.mock("../databases/placement", () => ({ databaseSwarmNodeId: transport.node }));
vi.mock("./recovery-copy-identity", () => ({
	inspectRecoveryRuntime: transport.identity,
	provisionRecoveryVolume: transport.provision,
	removeOriginalRecoveryVolume: transport.orphanRemove,
}));
vi.mock("../databases/logical", async (original) => ({
	...(await original<typeof import("../databases/logical")>()),
	findDatabaseContainerId: async () => "a".repeat(64),
}));
vi.mock("../../utils/exec", async (original) => ({
	...(await original<typeof import("../../utils/exec")>()),
	execAsyncWithStdin: transport.query,
	execAsync: transport.volume,
	execAsyncRemote: transport.remoteVolume,
}));
vi.mock("./runner", async (original) => ({
	...(await original<typeof import("./runner")>()),
	replayArchive: transport.replay,
}));
vi.mock("../traefik/paths", async (original) => ({
	...(await original<typeof import("../traefik/paths")>()),
	getConfigDir: () => transport.root,
}));

const testUrl = process.env.DATABASE_URL_TEST;
describe.skipIf(!testUrl)("retained PostgreSQL recovery copies (postgres)", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let schema: typeof import("../../db/schema");
	let db: typeof import("../../db")["db"];
	let orm: typeof import("drizzle-orm");
	let recovery: typeof import("./recovery-copy");
	let storage: typeof import("./storage");
	let a: TenantFixture;
	let b: TenantFixture;
	let source: typeof schema.postgres.$inferSelect;
	let backup: typeof schema.backups.$inferSelect;
	let environmentId: string;
	const key = "recovery/source/2026-10-20T12-00-00-000Z.gz";

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		transport.root = await mkdtemp(path.join(tmpdir(), "nixploy-recovery-"));
		harness = await import("../../trpc/tenancy.harness");
		({ db } = await import("../../db"));
		schema = await import("../../db/schema");
		orm = await import("drizzle-orm");
		recovery = await import("./recovery-copy");
		storage = await import("./storage");
		({ a, b } = await harness.seedTwoTenants());
		await db
			.update(schema.destinations)
			.set({ provider: "local" })
			.where(orm.eq(schema.destinations.destinationId, a.destinationId));
		const [row] = await db
			.update(schema.postgres)
			.set({
				appName: `recovery-source-${randomUUID().slice(0, 8)}`,
				dockerImage: "postgres:16-alpine",
				serverId: null,
				env: "SOURCE_ONLY=retained",
				command: "source-command",
			})
			.where(orm.eq(schema.postgres.postgresId, a.postgresId))
			.returning();
		if (!row) throw new Error("Source missing");
		source = row;
		const [environment] = await db
			.insert(schema.environments)
			.values({ projectId: a.projectId, name: "recovery-development" })
			.returning();
		if (!environment) throw new Error("Environment missing");
		environmentId = environment.environmentId;
		const [configured] = await db
			.insert(schema.backups)
			.values({
				appName: "source",
				schedule: "0 3 * * *",
				enabled: false,
				prefix: "recovery",
				database: source.databaseName,
				databaseType: "postgres",
				destinationId: a.destinationId,
				postgresId: source.postgresId,
			})
			.returning();
		if (!configured) throw new Error("Backup missing");
		backup = configured;
		await new storage.LocalBackupStore(
			storage.localDestinationRoot({ organizationId: a.organizationId }),
		).put(key, gzipSync("CREATE TABLE recovery_proof(id integer);"));
	}, 60_000);
	beforeEach(() => {
		vi.clearAllMocks();
		transport.replay.mockResolvedValue(undefined);
		transport.remove.mockReset().mockImplementation(async () => {
			transport.exists.mockResolvedValue(false);
		});
		transport.exists.mockReset().mockResolvedValue(true);
		transport.node.mockReset().mockResolvedValue("a".repeat(25));
		transport.provision.mockReset().mockResolvedValue("2026-10-20T12:00:00Z");
		transport.orphanRemove.mockReset().mockImplementation(async () => {
			transport.volume.mockResolvedValue("");
			transport.remoteVolume.mockResolvedValue("");
		});
		transport.identity.mockReset().mockImplementation(async (origin, containerId) => {
			if (containerId)
				return {
					serviceExists: true,
					volumeExists: true,
					containerId,
					volumeCreatedAt: "2026-10-20T12:00:00Z",
				};
			const serviceExists = await transport.exists(origin.originAppName);
			const command = `docker volume ls --filter name=^${origin.originVolumeName}$`;
			const volume =
				origin.originServerId === null
					? await transport.volume(command, { timeout: 30_000 })
					: await transport.remoteVolume(origin.originServerId, command, { timeoutMs: 30_000 });
			return { serviceExists, volumeExists: Boolean(volume.trim()) };
		});
		transport.volume.mockResolvedValue("");
		transport.remoteVolume.mockResolvedValue("");
	});
	afterAll(async () => {
		// Infrastructure is mocked in this suite. Remove only its nonce-owned
		// tracking fixtures explicitly before the production RESTRICT backstop.
		for (const fixture of [a, b]) {
			if (fixture)
				await db
					.delete(schema.recoveryCopies)
					.where(orm.eq(schema.recoveryCopies.organizationId, fixture.organizationId));
		}
		if (a) await harness.wipeTenant(a);
		if (b) await harness.wipeTenant(b);
		if (transport.root) await rm(transport.root, { recursive: true, force: true });
	});
	const input = () => ({
		backup,
		source,
		organizationId: a.organizationId,
		environmentId,
		name: "Recovery investigation",
		key,
		requestId: randomUUID(),
	});
	async function forgetMockTarget(copyId: string, targetId: string) {
		// Simulate already-missing metadata explicitly; production RESTRICT
		// prevents silent tracking loss through an ordinary target cascade.
		await db.transaction(async (tx) => {
			await tx
				.update(schema.recoveryCopies)
				.set({ targetPostgresId: null })
				.where(orm.eq(schema.recoveryCopies.recoveryCopyId, copyId));
			await tx.delete(schema.postgres).where(orm.eq(schema.postgres.postgresId, targetId));
		});
	}

	it("creates one fresh private target, preserves source, and replays one request idempotently", async () => {
		const request = input();
		const [first, competing] = await Promise.all([
			recovery.createRecoveryCopy(request),
			recovery.createRecoveryCopy(request),
		]);
		expect(first.recoveryCopyId).toBe(competing.recoveryCopyId);
		const final = await recovery.createRecoveryCopy(request);
		expect(final.status).toBe("ready");
		expect(final.tableCount).toBe(2);
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, final.targetPostgresId ?? ""),
		});
		expect(target).toMatchObject({
			environmentId,
			externalPort: null,
			env: null,
			command: null,
			dockerImage: source.dockerImage,
		});
		expect(target?.databasePassword).not.toBe(source.databasePassword);
		expect(target?.databaseUser).not.toBe(source.databaseUser);
		expect(final).toMatchObject({
			originServerId: null,
			originSwarmNodeId: "a".repeat(25),
			originAppName: target?.appName,
			originVolumeName: `${target?.appName}-data`,
		});
		expect(transport.deploy).toHaveBeenCalledTimes(1);
		expect(transport.replay).toHaveBeenCalledTimes(1);
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, source.postgresId),
			}),
		).toEqual(source);
		await expect(
			recovery.createRecoveryCopy({ ...request, name: "Different request" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const raw = await db.execute(
			orm.sql`select database_password from postgres where postgres_id = ${target?.postgresId}`,
		);
		expect(raw[0]?.database_password).not.toBe(target?.databasePassword);
	});

	it("rejects a corrupt archive before creating or starting any target", async () => {
		const badKey = "recovery/source/2099-01-01T00-00-00-000Z.gz";
		await new storage.LocalBackupStore(
			storage.localDestinationRoot({ organizationId: a.organizationId }),
		).put(badKey, Buffer.from("truncated gzip"));
		const result = await recovery.createRecoveryCopy({ ...input(), key: badKey });
		expect(result.status).toBe("error");
		expect(result.targetPostgresId).toBeNull();
		expect(transport.deploy).not.toHaveBeenCalled();
		expect(transport.replay).not.toHaveBeenCalled();
	});

	it("retains the immutable node and incomplete target when runtime identity fails before SQL replay", async () => {
		transport.identity.mockRejectedValueOnce(new Error("daemon changed or named volume mismatch"));
		const result = await recovery.createRecoveryCopy(input());
		expect(result).toMatchObject({ status: "error", originSwarmNodeId: "a".repeat(25) });
		expect(result.targetPostgresId).not.toBeNull();
		expect(transport.replay).not.toHaveBeenCalled();
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
			}),
		).toMatchObject({ status: "error" });
	});
	it("does not start a workload or replay SQL when a foreign preexisting volume blocks fresh storage", async () => {
		transport.provision.mockRejectedValueOnce(new Error("Fresh storage already exists"));
		const result = await recovery.createRecoveryCopy(input());
		expect(result.status).toBe("error");
		expect(result.targetPostgresId).not.toBeNull();
		expect(result.originVolumeCreatedAt).toBeNull();
		expect(transport.deploy).not.toHaveBeenCalled();
		expect(transport.replay).not.toHaveBeenCalled();
	});

	it("keeps deletion tracking and original resources when the recorded daemon identity changes", async () => {
		const result = await recovery.createRecoveryCopy(input());
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		transport.identity.mockRejectedValueOnce(new Error("different manager or rejoined daemon"));
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.remove).not.toHaveBeenCalled();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({
			status: "error",
			targetPostgresId: target.postgresId,
			originSwarmNodeId: result.originSwarmNodeId,
			originVolumeName: result.originVolumeName,
		});
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeDefined();
	});

	it("retries a partial teardown with its exact recorded volume and only clears tracking after absence", async () => {
		const result = await recovery.createRecoveryCopy(input());
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		transport.volume.mockResolvedValue(`${result.originVolumeName}\n`);
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		const retry = await db.query.recoveryCopies.findFirst({
			where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
		});
		if (!retry) throw new Error("Copy missing");
		expect(retry).toMatchObject({
			status: "error",
			targetPostgresId: target.postgresId,
			originVolumeCreatedAt: result.originVolumeCreatedAt,
		});
		await recovery.deleteRecoveryCopy(retry, target);
		expect(transport.remove).toHaveBeenCalledTimes(1);
		expect(transport.orphanRemove).toHaveBeenCalledWith(
			expect.objectContaining({
				recoveryCopyId: result.recoveryCopyId,
				originVolumeName: result.originVolumeName,
				originVolumeCreatedAt: result.originVolumeCreatedAt,
			}),
		);
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeUndefined();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({ status: "deleted", targetPostgresId: null });
	});

	it("rolls back target-FK clearing when the final target placement CAS fails", async () => {
		const result = await recovery.createRecoveryCopy(input());
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		transport.remove.mockImplementationOnce(async () => {
			await db
				.update(schema.postgres)
				.set({ appName: `changed-during-removal-${randomUUID().slice(0, 8)}` })
				.where(orm.eq(schema.postgres.postgresId, target.postgresId));
			transport.exists.mockResolvedValue(false);
		});
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({
			status: "error",
			targetPostgresId: target.postgresId,
			originAppName: result.originAppName,
		});
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeDefined();
	});

	it("does not guess an origin node for an older copy that recorded only its volume name", async () => {
		const result = await recovery.createRecoveryCopy(input());
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		const [legacy] = await db
			.update(schema.recoveryCopies)
			.set({ originSwarmNodeId: null })
			.where(orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId))
			.returning();
		if (!legacy) throw new Error("Copy missing");
		transport.identity.mockClear();
		await expect(recovery.deleteRecoveryCopy(legacy, target)).rejects.toThrow(
			"original recovery storage location is unknown",
		);
		expect(transport.identity).not.toHaveBeenCalled();
		expect(transport.remove).not.toHaveBeenCalled();
	});

	it("keeps a failed new target visible and never stores SQL output as an error", async () => {
		transport.replay.mockRejectedValueOnce(new Error("SECRET_CUSTOMER_DATA from SQL stderr"));
		const result = await recovery.createRecoveryCopy(input());
		expect(result.status).toBe("error");
		expect(result.targetPostgresId).not.toBeNull();
		expect(result.error).not.toContain("SECRET_CUSTOMER_DATA");
		expect(
			(
				await db.query.postgres.findFirst({
					where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
				})
			)?.status,
		).toBe("error");
		await expect(
			recovery.deleteRecoveryCopy(
				{ ...result, status: "restoring", deadline: new Date(Date.now() + 60_000) },
				null,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("applies source and target org/project guards before transport", async () => {
		const foreign = harness.createTestCaller(b.session);
		await expect(foreign.backup.copies({ backupId: backup.backupId })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			foreign.backup.createCopy({
				backupId: backup.backupId,
				environmentId,
				key,
				name: "Foreign",
				requestId: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const scoped = await harness.seedTeamScopedMember(a);
		try {
			const caller = harness.createTestCaller(scoped.session);
			await expect(
				caller.backup.createCopy({
					backupId: backup.backupId,
					environmentId: scoped.otherEnvironmentId,
					key,
					name: "Hidden target",
					requestId: randomUUID(),
				}),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			await db
				.update(schema.members)
				.set({ role: "member" })
				.where(orm.eq(schema.members.userId, scoped.userId));
			await expect(
				harness
					.createTestCaller({
						...scoped.session,
						session: { ...scoped.session.session, id: randomUUID() },
					})
					.backup.createCopy({
						backupId: backup.backupId,
						environmentId,
						key,
						name: "Denied role",
						requestId: randomUUID(),
					}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		} finally {
			await harness.wipeTeamScopedMember(scoped);
		}
		expect(transport.deploy).not.toHaveBeenCalled();
	});

	it("keeps tracking a remote copy when its data volume survives service deletion", async () => {
		const result = await recovery.createRecoveryCopy({
			...input(),
			source: { ...source, serverId: a.serverId },
		});
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		transport.remoteVolume.mockResolvedValue(`${target.appName}-data\n`);
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.remoteVolume).toHaveBeenCalledWith(
			a.serverId,
			expect.stringContaining(`${target.appName}-data`),
			{ timeoutMs: 30_000 },
		);
		expect(transport.volume).not.toHaveBeenCalled();
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeDefined();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({ status: "error", targetPostgresId: target.postgresId });
	});

	it.each(["server", "name"] as const)(
		"rejects a changed target %s before touching its original volume or any service",
		async (field) => {
			const result = await recovery.createRecoveryCopy(input());
			const originalTarget = await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
			});
			if (!originalTarget) throw new Error("Target missing");
			const [target] = await db
				.update(schema.postgres)
				.set(
					field === "server"
						? { serverId: a.serverId }
						: { appName: `moved-copy-${randomUUID().slice(0, 8)}` },
				)
				.where(orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""))
				.returning();
			if (!target || !result.originVolumeName) throw new Error("Target origin missing");
			const volumes = new Set([result.originVolumeName]);
			transport.remove.mockImplementation(async () => {
				volumes.delete(result.originVolumeName as string);
			});
			await expect(recovery.deleteRecoveryCopy(result, originalTarget)).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("moved from its recorded storage location"),
			});
			expect(transport.remove).not.toHaveBeenCalled();
			expect(transport.exists).not.toHaveBeenCalled();
			expect(transport.volume).not.toHaveBeenCalled();
			expect(transport.remoteVolume).not.toHaveBeenCalled();
			expect(volumes.has(result.originVolumeName)).toBe(true);
			expect(
				await db.query.recoveryCopies.findFirst({
					where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
				}),
			).toMatchObject({
				targetPostgresId: target.postgresId,
				originAppName: result.originAppName,
				originServerId: null,
				originVolumeName: result.originVolumeName,
			});
		},
	);

	it.each([true, false])(
		"refuses legacy cleanup without recorded origins when target row exists: %s",
		async (targetExists) => {
			const result = await recovery.createRecoveryCopy(input());
			const target = await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
			});
			if (!target) throw new Error("Target missing");
			await db
				.update(schema.recoveryCopies)
				.set({
					originAppName: null,
					originServerId: null,
					originVolumeName: null,
					originSwarmNodeId: null,
				})
				.where(orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId));
			if (!targetExists) await forgetMockTarget(result.recoveryCopyId, target.postgresId);
			const legacy = await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			});
			if (!legacy) throw new Error("Copy missing");
			await expect(
				recovery.deleteRecoveryCopy(legacy, targetExists ? target : null),
			).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("original recovery storage location is unknown"),
			});
			expect(transport.remove).not.toHaveBeenCalled();
			expect(transport.exists).not.toHaveBeenCalled();
			expect(transport.volume).not.toHaveBeenCalled();
			expect(transport.remoteVolume).not.toHaveBeenCalled();
			expect(
				await db.query.recoveryCopies.findFirst({
					where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
				}),
			).toMatchObject({ status: "ready", originVolumeName: null });
		},
	);

	it("verifies the original service and volume after its managed target row disappears", async () => {
		const result = await recovery.createRecoveryCopy(input());
		await forgetMockTarget(result.recoveryCopyId, result.targetPostgresId ?? "");
		const missing = await db.query.recoveryCopies.findFirst({
			where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
		});
		if (!missing) throw new Error("Copy missing");
		expect(missing.targetPostgresId).toBeNull();
		transport.exists.mockResolvedValueOnce(true);
		await expect(recovery.deleteRecoveryCopy(missing, null)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.exists).toHaveBeenCalledWith(result.originAppName);
		expect(transport.remove).not.toHaveBeenCalled();
		const retry = await db.query.recoveryCopies.findFirst({
			where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
		});
		if (!retry) throw new Error("Copy missing");
		transport.exists.mockResolvedValue(false);
		transport.volume.mockResolvedValueOnce(`${result.originVolumeName}\n`);
		await recovery.deleteRecoveryCopy(retry, null);
		expect(transport.orphanRemove).toHaveBeenCalledWith(
			expect.objectContaining({
				recoveryCopyId: result.recoveryCopyId,
				originSwarmNodeId: result.originSwarmNodeId,
				originVolumeCreatedAt: result.originVolumeCreatedAt,
			}),
		);
		expect(transport.volume).toHaveBeenCalledWith(
			expect.stringContaining(`name=^${result.originVolumeName}$`),
			{ timeout: 30_000 },
		);
		expect(transport.remove).not.toHaveBeenCalled();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({
			status: "deleted",
			originAppName: result.originAppName,
			originServerId: null,
			originVolumeName: result.originVolumeName,
		});
	});

	it("retains the remote origin when its server and managed target rows were removed", async () => {
		const [server] = await db
			.insert(schema.servers)
			.values({
				name: "Removed recovery host",
				ipAddress: "127.0.0.1",
				organizationId: a.organizationId,
			})
			.returning();
		if (!server) throw new Error("Server missing");
		const result = await recovery.createRecoveryCopy({
			...input(),
			source: { ...source, serverId: server.serverId },
		});
		await forgetMockTarget(result.recoveryCopyId, result.targetPostgresId ?? "");
		await db.delete(schema.servers).where(orm.eq(schema.servers.serverId, server.serverId));
		const missing = await db.query.recoveryCopies.findFirst({
			where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
		});
		if (!missing) throw new Error("Copy missing");
		expect(missing.originServerId).toBe(server.serverId);
		await expect(recovery.deleteRecoveryCopy(missing, null)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.remove).not.toHaveBeenCalled();
		expect(transport.exists).not.toHaveBeenCalled();
		expect(transport.volume).not.toHaveBeenCalled();
		expect(transport.remoteVolume).not.toHaveBeenCalled();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({
			status: "error",
			originServerId: server.serverId,
			originVolumeName: result.originVolumeName,
		});
	});

	it("keeps an unreachable origin remote instead of verifying the local daemon", async () => {
		const result = await recovery.createRecoveryCopy({
			...input(),
			source: { ...source, serverId: a.serverId },
		});
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		transport.remoteVolume.mockRejectedValueOnce(new Error("Original host unreachable"));
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.remoteVolume).toHaveBeenCalledWith(
			a.serverId,
			expect.stringContaining(`name=^${result.originVolumeName}$`),
			{ timeoutMs: 30_000 },
		);
		expect(transport.volume).not.toHaveBeenCalled();
		expect(
			await db.query.recoveryCopies.findFirst({
				where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
			}),
		).toMatchObject({
			status: "error",
			targetPostgresId: target.postgresId,
			originServerId: a.serverId,
		});
	});

	it("shows interrupted work honestly and only deletes its target", async () => {
		const result = await recovery.createRecoveryCopy(input());
		await expect(recovery.deleteRecoveryCopy(result, source)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(transport.remove).not.toHaveBeenCalled();
		const target = await db.query.postgres.findFirst({
			where: orm.eq(schema.postgres.postgresId, result.targetPostgresId ?? ""),
		});
		if (!target) throw new Error("Target missing");
		expect(
			recovery.recoveryCopyState({ status: "restoring", deadline: new Date(Date.now() - 120_000) }),
		).toBe("interrupted");
		transport.exists.mockResolvedValue(true);
		transport.remove.mockResolvedValue(undefined);
		await expect(recovery.deleteRecoveryCopy(result, target)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeDefined();
		const retry = await db.query.recoveryCopies.findFirst({
			where: orm.eq(schema.recoveryCopies.recoveryCopyId, result.recoveryCopyId),
		});
		if (!retry) throw new Error("Copy missing");
		transport.remove.mockImplementation(async () => {
			transport.exists.mockResolvedValue(false);
		});
		await recovery.deleteRecoveryCopy(retry, target);
		expect(transport.remove).toHaveBeenCalledWith(
			target.appName,
			null,
			"postgres",
			target.environmentId,
			{ recoveryCopyId: result.recoveryCopyId },
		);
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, target.postgresId),
			}),
		).toBeUndefined();
		expect(
			await db.query.postgres.findFirst({
				where: orm.eq(schema.postgres.postgresId, source.postgresId),
			}),
		).toEqual(source);
	});
});
