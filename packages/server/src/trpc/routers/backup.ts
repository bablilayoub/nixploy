import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { backups, destinations } from "../../db/schema";
import { getServiceContext } from "../../modules/application";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { WEB_SERVER_APP_NAME } from "../../modules/backups/instance-backup";
import { listBackupKeys, restoreBackup } from "../../modules/backups/runner";
import {
	isValidBackupCron,
	registerBackupSchedule,
	runBackupNow,
	unregisterBackupSchedule,
} from "../../modules/backups/scheduler";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";
import { redactDestinationSecrets } from "../redact-secrets";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Database services that map to a linked service row (instance backups excluded). */
const backupDatabaseTypeSchema = z.enum(["postgres", "mysql", "mariadb", "mongo", "redis"]);

/** Org scope travels through the destination (and the linked DB service). */
async function findBackupOrThrow(backupId: string, organizationId: string) {
	const row = await db.query.backups.findFirst({
		where: eq(backups.backupId, backupId),
		with: { destination: true },
	});
	if (!row || row.destination.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
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
	databaseType: z.infer<typeof backupDatabaseTypeSchema>,
	serviceId: string,
	organizationId: string,
) {
	const context = await getServiceContext(databaseType, serviceId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Database service not found" });
	}
	return context;
}

/** FK column matching a database type. */
const serviceIdColumn = (databaseType: z.infer<typeof backupDatabaseTypeSchema>) =>
	databaseType === "postgres"
		? backups.postgresId
		: databaseType === "mysql"
			? backups.mysqlId
			: databaseType === "mariadb"
				? backups.mariadbId
				: databaseType === "mongo"
					? backups.mongoId
					: backups.redisId;

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

export const backupRouter = router({
	/** Backups configured for one database service, or the instance itself. */
	all: protectedProcedure.input(allInputSchema).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		if (input.databaseType === "web-server") {
			// Instance backups have no service FK — org scope travels through
			// the destination alone.
			const rows = await db.query.backups.findMany({
				where: eq(backups.databaseType, "web-server"),
				orderBy: [desc(backups.createdAt)],
				with: { destination: true },
			});
			return rows
				.filter((row) => row.destination.organizationId === organizationId)
				.map(({ destination: _, ...row }) => row);
		}
		await assertDatabaseServiceAccess(input.databaseType, input.serviceId, organizationId);
		return await db.query.backups.findMany({
			where: eq(serviceIdColumn(input.databaseType), input.serviceId),
			orderBy: [desc(backups.createdAt)],
		});
	}),

	/** A single backup by id. */
	one: protectedProcedure.input(backupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findBackupOrThrow(input.backupId, organizationId);
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
			const existing = await findBackupOrThrow(input.backupId, organizationId);
			if (existing.databaseType === "web-server") {
				await assertInstanceAdmin(ctx.session);
			}
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
			return row;
		}),

	/** Delete a backup and cancel its cron job (stored dumps are kept). */
	remove: protectedProcedure.input(backupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findBackupOrThrow(input.backupId, organizationId);
		if (row.databaseType === "web-server") {
			await assertInstanceAdmin(ctx.session);
		}
		unregisterBackupSchedule(row.backupId);
		await db.delete(backups).where(eq(backups.backupId, row.backupId));
		return true;
	}),

	/** Run the dump + upload immediately. */
	runManually: protectedProcedure.input(backupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findBackupOrThrow(input.backupId, organizationId);
		if (row.databaseType === "web-server") {
			await assertInstanceAdmin(ctx.session);
		}
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
		const row = await findBackupOrThrow(input.backupId, organizationId);
		return await listBackupKeys(row);
	}),

	/** Restore the database from a stored dump (newest when `key` omitted). */
	restore: protectedProcedure
		.input(backupIdInput.extend({ key: z.string().min(1).optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			const row = await findBackupOrThrow(input.backupId, organizationId);
			return await restoreBackup(row, input.key);
		}),
});
