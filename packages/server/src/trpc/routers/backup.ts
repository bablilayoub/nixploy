import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	backups,
	destinations,
	environments,
	postgres,
	projects,
	recoveryCopies,
} from "../../db/schema";
import { getServiceContext } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { WEB_SERVER_APP_NAME } from "../../modules/backups/instance-backup";
import {
	createRecoveryCopy,
	deleteRecoveryCopy,
	listRecoveryCopies,
	type RecoveryCopy,
	recoveryCopyState,
} from "../../modules/backups/recovery-copy";
import { listBackupKeys, restoreBackup, verifyBackup } from "../../modules/backups/runner";
import { latestBackupRuns, listBackupRuns } from "../../modules/backups/runs";
import {
	isValidBackupCron,
	registerBackupSchedule,
	runBackupNow,
	unregisterBackupSchedule,
} from "../../modules/backups/scheduler";
import { isDomainError, notFound, preconditionFailed } from "../../modules/errors";
import {
	assertCapability,
	assertOrgRole,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { assertProjectVisible, isProjectVisible } from "../../modules/projects/project-scope";
import {
	type DatabaseServiceKind,
	databaseKindSchema,
	SERVICE_REGISTRY,
} from "../../modules/services/registry";
import { assertServerInOrganization } from "../assert-org-refs";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";
import { redactDestinationSecrets } from "../redact-secrets";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Database services that map to a linked service row (instance backups excluded). */
const backupDatabaseTypeSchema = databaseKindSchema;

/** Destination ownership and the linked service's project scope apply to every ID lookup. */
async function findBackupOrThrow(backupId: string, organizationId: string, session: Session) {
	const row = await db.query.backups.findFirst({
		where: eq(backups.backupId, backupId),
		with: { destination: true },
	});
	if (!row || row.destination.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
	}
	if (row.databaseType === "web-server") {
		await assertInstanceAdmin(session);
	} else {
		const serviceId = row[SERVICE_REGISTRY[row.databaseType].idField];
		if (!serviceId) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
		}
		await assertDatabaseServiceAccess(row.databaseType, serviceId, organizationId);
	}
	return row;
}

async function assertDestinationAccess(destinationId: string, organizationId: string) {
	const row = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, destinationId),
	});
	if (!row || row.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found" });
	}
	return row;
}

/** Verify the linked database service belongs to the caller's org. */
async function assertDatabaseServiceAccess(
	databaseType: DatabaseServiceKind,
	serviceId: string,
	organizationId: string,
) {
	const context = await getServiceContext(databaseType, serviceId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Database service not found" });
	}
	return context;
}

/** FK column on `backup` matching a database type (`backups.postgresId`, …). */
const serviceIdColumn = (databaseType: DatabaseServiceKind) => {
	const column = SERVICE_REGISTRY[databaseType].backupColumn;
	if (!column) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${databaseType} services cannot be backed up`,
		});
	}
	return column;
};

/** `web-server` backups point at the instance itself — no service FK. */
const allInputSchema = z.discriminatedUnion("databaseType", [
	z.object({ serviceId: z.string().min(1), databaseType: backupDatabaseTypeSchema }),
	z.object({ databaseType: z.literal("web-server") }),
]);

const createInputSchema = z.discriminatedUnion("databaseType", [
	z.object({
		schedule: z.string().min(1),
		enabled: z.boolean().optional(),
		prefix: z.string().min(1).optional(),
		database: z.string().min(1),
		databaseType: backupDatabaseTypeSchema,
		keepLatestCount: z.number().int().min(1).nullish(),
		destinationId: z.string().min(1),
		serviceId: z.string().min(1),
	}),
	z.object({
		schedule: z.string().min(1),
		enabled: z.boolean().optional(),
		prefix: z.string().min(1).optional(),
		database: z.string().min(1),
		databaseType: z.literal("web-server"),
		keepLatestCount: z.number().int().min(1).nullish(),
		destinationId: z.string().min(1),
	}),
]);

const backupIdInput = z.object({ backupId: z.string().min(1) });
const copiesInput = z.union([
	backupIdInput.strict(),
	z.object({ postgresId: z.string().min(1) }).strict(),
	z.object({ projectId: z.string().min(1) }).strict(),
]);

const copyCursorInput = z
	.object({ createdAt: z.iso.datetime({ offset: true }), id: z.string().min(1) })
	.strict();
const copyInventoryInput = z.union([
	z.object({ postgresId: z.string().min(1), cursor: copyCursorInput.optional() }).strict(),
	z.object({ projectId: z.string().min(1), cursor: copyCursorInput.optional() }).strict(),
]);

/** Attach each row's newest `backup_run` (status badge in the lists). */
async function withLastRun<T extends { backupId: string }>(rows: T[]) {
	const latest = await latestBackupRuns({ backupIds: rows.map((row) => row.backupId) });
	return rows.map((row) => ({ ...row, lastRun: latest.get(row.backupId) ?? null }));
}

/** Rejects stored-object keys that could never have been produced by the runner. */
const objectKeySchema = z
	.string()
	.min(1)
	.max(1024)
	.refine((key) => !key.includes("\0") && !key.startsWith("/") && !key.split("/").includes(".."), {
		message: "Invalid object key",
	});

async function recoveryEnvironment(environmentId: string, organizationId: string) {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment || environment.project.organizationId !== organizationId)
		throw notFound("Environment not found");
	assertProjectVisible(environment.projectId, "Environment");
	return environment;
}

async function recoveryTarget(postgresId: string, organizationId: string) {
	await assertDatabaseServiceAccess("postgres", postgresId, organizationId);
	const row = await db.query.postgres.findFirst({ where: eq(postgres.postgresId, postgresId) });
	if (!row) throw notFound("Recovery database not found");
	return row;
}

async function assertRecoveryInventoryAccess(
	input: z.infer<typeof copiesInput>,
	organizationId: string,
	session: Session,
) {
	if ("backupId" in input) {
		await findBackupOrThrow(input.backupId, organizationId, session);
	} else if ("postgresId" in input) {
		await recoveryTarget(input.postgresId, organizationId);
	} else {
		const project = await db.query.projects.findFirst({
			where: and(
				eq(projects.projectId, input.projectId),
				eq(projects.organizationId, organizationId),
			),
		});
		if (!project) throw notFound("Project not found");
		assertProjectVisible(project.projectId);
	}
}

async function recoveryInventoryRows(
	rows: Awaited<ReturnType<typeof listRecoveryCopies>>,
	organizationId: string,
	session: Session,
) {
	const result: (Omit<RecoveryCopy, "status"> & {
		status: string;
		projectId: string;
		targetEnvironmentName: string;
	})[] = [];
	for (const { cursorCreatedAt: _cursorCreatedAt, ...row } of rows) {
		if (row.organizationId !== organizationId) continue;
		const environment = await db.query.environments.findFirst({
			where: eq(environments.environmentId, row.environmentId),
			with: { project: true },
		});
		if (
			!environment ||
			environment.project.organizationId !== organizationId ||
			!isProjectVisible(environment.projectId)
		)
			continue;
		// The source or target may have moved since this copy was created.
		// Null/deleted service metadata leaves the recorded environment as
		// the inventory anchor; an existing service must still be reachable.
		const source = row.sourcePostgresId
			? await db.query.postgres.findFirst({
					where: eq(postgres.postgresId, row.sourcePostgresId),
					with: { environment: { with: { project: true } } },
				})
			: null;
		const target = row.targetPostgresId
			? await db.query.postgres.findFirst({
					where: eq(postgres.postgresId, row.targetPostgresId),
					with: { environment: { with: { project: true } } },
				})
			: null;
		if (
			[source, target].some(
				(service) =>
					service &&
					(service.environment.project.organizationId !== organizationId ||
						!isProjectVisible(service.environment.projectId)),
			)
		)
			continue;
		if (row.backupId) {
			try {
				await findBackupOrThrow(row.backupId, organizationId, session);
			} catch (error) {
				if ((error instanceof TRPCError || isDomainError(error)) && error.code === "NOT_FOUND")
					continue;
				throw error;
			}
		}
		result.push({
			...row,
			status: !target && row.status === "ready" ? "interrupted" : recoveryCopyState(row),
			projectId: target?.environment.projectId ?? environment.projectId,
			targetEnvironmentName: target?.environment.name ?? environment.name,
		});
	}
	return result;
}

export const backupRouter = router({
	/** Legacy latest-100 array; service/project inventory also survives schedule deletion. */
	copies: protectedProcedure.input(copiesInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertRecoveryInventoryAccess(input, organizationId, ctx.session);
		return await recoveryInventoryRows(
			await listRecoveryCopies(input, organizationId),
			organizationId,
			ctx.session,
		);
	}),

	/** Exact timestamp+ID cursor keeps older retained data reachable after long history. */
	copyInventory: protectedProcedure.input(copyInventoryInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertRecoveryInventoryAccess(input, organizationId, ctx.session);
		const rows = await listRecoveryCopies(input, organizationId, {
			cursor: input.cursor,
			limit: 101,
		});
		const page = rows.slice(0, 100);
		const last = page.at(-1);
		return {
			items: await recoveryInventoryRows(page, organizationId, ctx.session),
			nextCursor:
				rows.length > 100 && last
					? { createdAt: last.cursorCreatedAt, id: last.recoveryCopyId }
					: null,
		};
	}),

	/** Blocks until validation/restore finishes. Replaying requestId never creates another service. */
	createCopy: protectedProcedure
		.input(
			backupIdInput.extend({
				key: objectKeySchema,
				environmentId: z.string().min(1),
				name: z.string().trim().min(1).max(200),
				requestId: z.uuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			for (const capability of [
				"backups.manage",
				"service.create",
				"service.deploy",
				"secrets.write",
			] as const)
				await assertCapability(ctx.session.user.id, organizationId, capability);
			const backup = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
			if (backup.databaseType !== "postgres" || !backup.postgresId)
				throw preconditionFailed("Recovery copies currently support PostgreSQL backups only");
			const source = await recoveryTarget(backup.postgresId, organizationId);
			const environment = await recoveryEnvironment(input.environmentId, organizationId);
			if (environment.environmentId === source.environmentId)
				throw preconditionFailed(
					"Choose another environment to keep the recovery copy on a separate private network",
				);
			await assertServerInOrganization(source.serverId, organizationId);
			const previous = await db.query.recoveryCopies.findFirst({
				where: and(
					eq(recoveryCopies.organizationId, organizationId),
					eq(recoveryCopies.requestId, input.requestId),
				),
			});
			if (previous?.organizationId === organizationId && previous.targetPostgresId)
				await recoveryTarget(previous.targetPostgresId, organizationId);
			const result = await createRecoveryCopy({ ...input, backup, source, organizationId });
			void auditFromSession(ctx, organizationId, {
				action: "backup.createCopy",
				targetType: "backup",
				targetId: backup.backupId,
				targetName: input.name,
				metadata: {
					recoveryCopyId: result.recoveryCopyId,
					targetPostgresId: result.targetPostgresId,
					status: result.status,
				},
			});
			return {
				recoveryCopyId: result.recoveryCopyId,
				status: recoveryCopyState(result),
				targetPostgresId: result.targetPostgresId,
				projectId: environment.projectId,
				error: result.error,
				tableCount: result.tableCount,
			};
		}),

	/** Deletes only the managed target; no archive/source service is changed. */
	deleteCopy: protectedProcedure
		.input(z.object({ recoveryCopyId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			for (const capability of ["backups.manage", "service.delete"] as const)
				await assertCapability(ctx.session.user.id, organizationId, capability);
			const row = await db.query.recoveryCopies.findFirst({
				where: eq(recoveryCopies.recoveryCopyId, input.recoveryCopyId),
			});
			if (!row || row.organizationId !== organizationId) throw notFound("Recovery copy not found");
			if (row.backupId) await findBackupOrThrow(row.backupId, organizationId, ctx.session);
			if (row.sourcePostgresId) await recoveryTarget(row.sourcePostgresId, organizationId);
			await recoveryEnvironment(row.environmentId, organizationId);
			const target = row.targetPostgresId
				? await recoveryTarget(row.targetPostgresId, organizationId)
				: null;
			await deleteRecoveryCopy(row, target);
			void auditFromSession(ctx, organizationId, {
				action: "backup.deleteCopy",
				targetType: "postgres",
				targetId: row.targetPostgresId ?? row.recoveryCopyId,
				targetName: row.name,
			});
			return { success: true };
		}),

	/** Backups configured for one database service, or the instance itself, with their last run. */
	all: protectedProcedure.input(allInputSchema).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		if (input.databaseType === "web-server") {
			await assertInstanceAdmin(ctx.session);
			// Instance backups have no service FK — org scope travels through
			// the destination alone.
			const rows = await db.query.backups.findMany({
				where: eq(backups.databaseType, "web-server"),
				orderBy: [desc(backups.createdAt)],
				with: { destination: true },
			});
			return await withLastRun(
				rows
					.filter((row) => row.destination.organizationId === organizationId)
					.map(({ destination: _, ...row }) => row),
			);
		}
		await assertDatabaseServiceAccess(input.databaseType, input.serviceId, organizationId);
		const rows = await db.query.backups.findMany({
			where: eq(serviceIdColumn(input.databaseType), input.serviceId),
			orderBy: [desc(backups.createdAt)],
		});
		return await withLastRun(rows);
	}),

	/** Run history of one backup, newest first (status, timing, size, key, error). */
	runs: protectedProcedure
		.input(backupIdInput.extend({ limit: z.number().int().min(1).max(200).optional() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
			return await listBackupRuns({ backupId: row.backupId }, input.limit ?? 20);
		}),

	/** A single backup by id. */
	one: protectedProcedure.input(backupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
		return {
			...row,
			destination: redactDestinationSecrets(row.destination),
		};
	}),

	/** Create a scheduled dump → S3 backup for a database service or the instance. */
	create: protectedProcedure.input(createInputSchema).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		if (!isValidBackupCron(input.schedule)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Invalid cron expression: ${input.schedule}`,
			});
		}
		await assertDestinationAccess(input.destinationId, organizationId);

		let appName: string;
		if (input.databaseType === "web-server") {
			// Instance backups dump every tenant's rows plus the config dir
			// (acme.json, SSH keys) — platform-level, instance admins only.
			await assertInstanceAdmin(ctx.session);
			appName = WEB_SERVER_APP_NAME;
		} else {
			const service = await assertDatabaseServiceAccess(
				input.databaseType,
				input.serviceId,
				organizationId,
			);
			appName = service.appName;
		}

		const [row] = await db
			.insert(backups)
			.values({
				appName,
				schedule: input.schedule,
				enabled: input.enabled ?? true,
				prefix: input.prefix ?? "backup",
				database: input.database,
				databaseType: input.databaseType,
				keepLatestCount: input.keepLatestCount ?? null,
				destinationId: input.destinationId,
				postgresId: input.databaseType === "postgres" ? input.serviceId : null,
				mysqlId: input.databaseType === "mysql" ? input.serviceId : null,
				mariadbId: input.databaseType === "mariadb" ? input.serviceId : null,
				mongoId: input.databaseType === "mongo" ? input.serviceId : null,
				redisId: input.databaseType === "redis" ? input.serviceId : null,
			})
			.returning();
		if (!row) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
		}
		registerBackupSchedule(row);
		void auditFromSession(ctx, organizationId, {
			action: "backup.create",
			targetType: "backup",
			targetId: row.backupId,
			targetName: row.appName,
			metadata: { databaseType: row.databaseType, schedule: row.schedule },
		});
		return row;
	}),

	/** Update a backup; the cron job is re-registered. */
	update: protectedProcedure
		.input(
			backupIdInput.extend({
				schedule: z.string().min(1).optional(),
				enabled: z.boolean().optional(),
				prefix: z.string().min(1).optional(),
				database: z.string().min(1).optional(),
				keepLatestCount: z.number().int().min(1).nullish(),
				destinationId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			await findBackupOrThrow(input.backupId, organizationId, ctx.session);
			if (input.schedule && !isValidBackupCron(input.schedule)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.schedule}`,
				});
			}
			if (input.destinationId) {
				await assertDestinationAccess(input.destinationId, organizationId);
			}
			const { backupId, ...values } = input;
			const [row] = await db
				.update(backups)
				.set(values)
				.where(eq(backups.backupId, backupId))
				.returning();
			if (!row) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
			}
			registerBackupSchedule(row);
			void auditFromSession(ctx, organizationId, {
				action: "backup.update",
				targetType: "backup",
				targetId: row.backupId,
				targetName: row.appName,
				metadata: {
					databaseType: row.databaseType,
					schedule: row.schedule,
					enabled: row.enabled,
					destinationChanged: input.destinationId !== undefined,
				},
			});
			return row;
		}),

	/** Delete a backup and cancel its cron job (stored dumps are kept). */
	remove: protectedProcedure.input(backupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
		unregisterBackupSchedule(row.backupId);
		await db.delete(backups).where(eq(backups.backupId, row.backupId));
		void auditFromSession(ctx, organizationId, {
			action: "backup.delete",
			targetType: "backup",
			targetId: row.backupId,
			targetName: row.appName,
		});
		return true;
	}),

	/** Run the dump + upload immediately. */
	runManually: protectedProcedure.input(backupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
		void auditFromSession(ctx, organizationId, {
			action: "backup.run",
			targetType: "backup",
			targetId: row.backupId,
			targetName: row.appName,
		});
		try {
			await runBackupNow(row);
		} catch (error) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: error instanceof Error ? error.message : "Backup failed",
			});
		}
		return { success: true };
	}),

	/** Stored dump keys (newest first) for the restore picker. */
	listBackups: protectedProcedure.input(backupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
		return await listBackupKeys(row);
	}),

	/** Restore the database from a stored dump (newest when `key` omitted). */
	restore: protectedProcedure
		.input(backupIdInput.extend({ key: objectKeySchema.optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
			const result = await restoreBackup(row, input.key);
			void auditFromSession(ctx, organizationId, {
				action: "backup.restore",
				targetType: "backup",
				targetId: row.backupId,
				targetName: row.appName,
				metadata: { key: result.key },
			});
			return result;
		}),

	/**
	 * Test-restore a stored dump into a throwaway container of the same
	 * engine image and run its liveness query. Never touches the live
	 * service; the outcome lands in the run history (`trigger: "verify"`).
	 * Blocks until done (time-boxed to 10 minutes).
	 */
	verify: protectedProcedure
		.input(backupIdInput.extend({ key: objectKeySchema.optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			const row = await findBackupOrThrow(input.backupId, organizationId, ctx.session);
			let result: Awaited<ReturnType<typeof verifyBackup>>;
			try {
				result = await verifyBackup(row, input.key);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Restore verification failed",
				});
			}
			void auditFromSession(ctx, organizationId, {
				action: "backup.verify",
				targetType: "backup",
				targetId: row.backupId,
				targetName: row.appName,
				metadata: { key: result.key, bytes: result.bytes },
			});
			return result;
		}),
});
