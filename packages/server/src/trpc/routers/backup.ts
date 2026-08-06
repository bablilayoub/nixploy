import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { backups, destinations } from "../../db/schema";
import { getServiceContext } from "../../modules/application";
import { type BackupRow, listBackupKeys, restoreBackup } from "../../modules/backups/runner";
import {
	isValidBackupCron,
	registerBackupSchedule,
	runBackupNow,
	unregisterBackupSchedule,
} from "../../modules/backups/scheduler";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const backupDatabaseTypeSchema = z.enum(["postgres", "mysql", "mariadb", "mongo"]);

/** Org scope travels through the destination (and the linked DB service). */
async function findBackupOrThrow(backupId: string, organizationId: string): Promise<BackupRow> {
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
				: backups.mongoId;

const backupIdInput = z.object({ backupId: z.string().min(1) });

export const backupRouter = router({
	/** Backups configured for one database service. */
	all: protectedProcedure
		.input(
			z.object({
				serviceId: z.string().min(1),
				databaseType: backupDatabaseTypeSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertDatabaseServiceAccess(input.databaseType, input.serviceId, organizationId);
			return await db.query.backups.findMany({
				where: eq(serviceIdColumn(input.databaseType), input.serviceId),
				orderBy: [desc(backups.createdAt)],
			});
		}),

	/** A single backup by id. */
	one: protectedProcedure.input(backupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await findBackupOrThrow(input.backupId, organizationId);
	}),

	/** Create a scheduled dump → S3 backup for a database service. */
	create: protectedProcedure
		.input(
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
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "deployer");
			if (!isValidBackupCron(input.schedule)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.schedule}`,
				});
			}
			await assertDestinationAccess(input.destinationId, organizationId);
			const service = await assertDatabaseServiceAccess(
				input.databaseType,
				input.serviceId,
				organizationId,
			);
			const [row] = await db
				.insert(backups)
				.values({
					appName: service.appName,
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
			await assertOrgRole(ctx.session.user.id, organizationId, "deployer");
			await findBackupOrThrow(input.backupId, organizationId);
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
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const row = await findBackupOrThrow(input.backupId, organizationId);
		unregisterBackupSchedule(row.backupId);
		await db.delete(backups).where(eq(backups.backupId, row.backupId));
		return true;
	}),

	/** Run the dump + upload immediately. */
	runManually: protectedProcedure.input(backupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "deployer");
		const row = await findBackupOrThrow(input.backupId, organizationId);
		await runBackupNow(row);
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
			await assertOrgRole(ctx.session.user.id, organizationId, "deployer");
			const row = await findBackupOrThrow(input.backupId, organizationId);
			return await restoreBackup(row, input.key);
		}),
});
