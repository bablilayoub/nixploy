import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { destinations, mounts, volumeBackups } from "../../db/schema";
import { getServiceContext } from "../../modules/application";
import { listVolumeBackupKeys, restoreVolumeBackup } from "../../modules/backups/runner";
import {
	isValidBackupCron,
	registerVolumeBackupSchedule,
	runVolumeBackupNow,
	unregisterVolumeBackupSchedule,
} from "../../modules/backups/scheduler";
import { PROTECTED_VOLUMES } from "../../modules/docker/protected";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { assertDockerVolumeName } from "../../utils/validators";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";
import { redactDestinationSecrets } from "../redact-secrets";

const volumeNameSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(
		/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
		"volumeName must be a Docker volume name, not a host path",
	);

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const volumeServiceTypeSchema = z.enum(["application", "compose"]);

/** Org scope travels through the destination (and the linked service). */
async function findVolumeBackupOrThrow(volumeBackupId: string, organizationId: string) {
	const row = await db.query.volumeBackups.findFirst({
		where: eq(volumeBackups.volumeBackupId, volumeBackupId),
		with: { destination: true },
	});
	if (!row || row.destination.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Volume backup not found" });
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

/** Verify the linked application/compose service belongs to the caller's org. */
async function assertServiceAccess(
	serviceType: z.infer<typeof volumeServiceTypeSchema>,
	serviceId: string,
	organizationId: string,
) {
	const context = await getServiceContext(serviceType, serviceId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
	}
	return context;
}

/** Volume must be owned by the linked service — never an arbitrary host volume. */
async function assertVolumeOwnedByService(
	serviceType: z.infer<typeof volumeServiceTypeSchema>,
	serviceId: string,
	volumeName: string,
	organizationId: string,
): Promise<void> {
	const context = await assertServiceAccess(serviceType, serviceId, organizationId);
	if (serviceType === "application") {
		const rows = await db.query.mounts.findMany({
			where: eq(mounts.applicationId, serviceId),
		});
		const allowed = new Set(
			rows
				.filter((row) => row.type === "volume" && row.volumeName)
				.map((row) => row.volumeName as string),
		);
		if (!allowed.has(volumeName)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Volume "${volumeName}" is not attached to this application`,
			});
		}
		return;
	}
	// Compose/stack volumes are project-prefixed as `<appName>_<name>`.
	const prefix = `${context.appName}_`;
	if (volumeName !== context.appName && !volumeName.startsWith(prefix)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Volume "${volumeName}" is not owned by compose project "${context.appName}"`,
		});
	}
}

const volumeBackupIdInput = z.object({ volumeBackupId: z.string().min(1) });

export const volumeBackupRouter = router({
	/** Volume backups configured for one application/compose service. */
	all: protectedProcedure
		.input(
			z.object({
				serviceId: z.string().min(1),
				serviceType: volumeServiceTypeSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertServiceAccess(input.serviceType, input.serviceId, organizationId);
			const column =
				input.serviceType === "application" ? volumeBackups.applicationId : volumeBackups.composeId;
			return await db.query.volumeBackups.findMany({
				where: eq(column, input.serviceId),
				orderBy: [desc(volumeBackups.createdAt)],
			});
		}),

	/** A single volume backup by id. */
	one: protectedProcedure.input(volumeBackupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
		return {
			...row,
			destination: redactDestinationSecrets(row.destination),
		};
	}),

	/** Create a scheduled volume archive → S3 backup. */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				volumeName: volumeNameSchema,
				serviceType: volumeServiceTypeSchema,
				cronExpression: z.string().min(1),
				enabled: z.boolean().optional(),
				prefix: z.string().min(1).optional(),
				keepLatestCount: z.number().int().min(1).nullish(),
				destinationId: z.string().min(1),
				serviceId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			if (!isValidBackupCron(input.cronExpression)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.cronExpression}`,
				});
			}
			await assertDestinationAccess(input.destinationId, organizationId);
			await assertVolumeOwnedByService(
				input.serviceType,
				input.serviceId,
				input.volumeName,
				organizationId,
			);
			assertDockerVolumeName(input.volumeName);
			if (PROTECTED_VOLUMES.has(input.volumeName)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Volume "${input.volumeName}" is a Nixploy platform volume and cannot be backed up from here`,
				});
			}
			const [row] = await db
				.insert(volumeBackups)
				.values({
					name: input.name,
					volumeName: input.volumeName,
					serviceType: input.serviceType,
					cronExpression: input.cronExpression,
					enabled: input.enabled ?? true,
					prefix: input.prefix ?? "volume-backup",
					keepLatestCount: input.keepLatestCount ?? null,
					destinationId: input.destinationId,
					applicationId: input.serviceType === "application" ? input.serviceId : null,
					composeId: input.serviceType === "compose" ? input.serviceId : null,
				})
				.returning();
			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}
			registerVolumeBackupSchedule(row);
			return row;
		}),

	/** Update a volume backup; the cron job is re-registered. */
	update: protectedProcedure
		.input(
			volumeBackupIdInput.extend({
				name: z.string().min(1).optional(),
				volumeName: volumeNameSchema.optional(),
				cronExpression: z.string().min(1).optional(),
				enabled: z.boolean().optional(),
				prefix: z.string().min(1).optional(),
				keepLatestCount: z.number().int().min(1).nullish(),
				destinationId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			const existing = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
			if (input.cronExpression && !isValidBackupCron(input.cronExpression)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.cronExpression}`,
				});
			}
			if (input.destinationId) {
				await assertDestinationAccess(input.destinationId, organizationId);
			}
			if (input.volumeName) {
				assertDockerVolumeName(input.volumeName);
				if (PROTECTED_VOLUMES.has(input.volumeName)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Volume "${input.volumeName}" is a Nixploy platform volume and cannot be backed up from here`,
					});
				}
				const serviceType = existing.serviceType === "compose" ? "compose" : "application";
				const serviceId = serviceType === "compose" ? existing.composeId : existing.applicationId;
				if (!serviceId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Volume backup has no linked service",
					});
				}
				await assertVolumeOwnedByService(serviceType, serviceId, input.volumeName, organizationId);
			}
			const { volumeBackupId, ...values } = input;
			const [row] = await db
				.update(volumeBackups)
				.set(values)
				.where(eq(volumeBackups.volumeBackupId, volumeBackupId))
				.returning();
			if (!row) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Volume backup not found" });
			}
			registerVolumeBackupSchedule(row);
			return row;
		}),

	/** Delete a volume backup and cancel its cron job (archives are kept). */
	remove: protectedProcedure.input(volumeBackupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
		unregisterVolumeBackupSchedule(row.volumeBackupId);
		await db.delete(volumeBackups).where(eq(volumeBackups.volumeBackupId, row.volumeBackupId));
		return true;
	}),

	/** Run the archive + upload immediately. */
	runManually: protectedProcedure.input(volumeBackupIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
		const row = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
		await runVolumeBackupNow(row);
		return { success: true };
	}),

	/** Stored archive keys (newest first) for the restore picker. */
	listBackups: protectedProcedure.input(volumeBackupIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
		return await listVolumeBackupKeys(row);
	}),

	/** Restore the volume from a stored archive (newest when `key` omitted). */
	restore: protectedProcedure
		.input(volumeBackupIdInput.extend({ key: z.string().min(1).optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "backups.manage");
			const row = await findVolumeBackupOrThrow(input.volumeBackupId, organizationId);
			return await restoreVolumeBackup(row, input.key);
		}),
});
