import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { mounts } from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	materializeFileMount,
	removeFileMount,
	upsertApplicationSwarmService,
} from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findComposeForOrg } from "../../modules/compose/service";
import { notFound } from "../../modules/errors";
import { assertCapability, hasCapability } from "../../modules/projects";
import {
	assertSafeFilePath,
	assertSafeHostPath,
	assertSafeVolumeName,
	validateMountFields,
} from "../../modules/services/mounts";
import { mountContentSchema } from "../../utils/input-limits";
import { protectedProcedure, router } from "../init";

const mountFields = {
	type: z.enum(["bind", "volume", "file"]),
	/** Container-side path. */
	mountPath: z.string().min(1),
	/** bind: absolute path on the host. */
	hostPath: z.string().nullable().optional(),
	/** volume: named docker volume. */
	volumeName: z.string().nullable().optional(),
	/** file: path relative to the app's files dir (`<configDir>/applications/<appName>/files`). */
	filePath: z.string().nullable().optional(),
	/** file: content written to `filePath` (capped at 256 KiB). */
	content: mountContentSchema.nullable().optional(),
} as const;

/**
 * The service a mount belongs to, reduced to what the router needs.
 *
 * Applications and compose stacks both own mounts, and the rows differ only in
 * which parent id is set plus, for compose, the `serviceName` that says which
 * container of the stack the volume goes in. Resolving to this shape keeps one
 * copy of the validation and file handling for both.
 */
interface MountOwner {
	kind: "application" | "compose";
	appName: string;
	serverId: string | null;
	/** Set for applications; the Swarm spec is re-applied after every change. */
	application?: Awaited<ReturnType<typeof assertApplicationAccess>>;
}

const composeOwner = async (composeId: string, organizationId: string): Promise<MountOwner> => {
	const row = await findComposeForOrg(composeId, organizationId);
	return { kind: "compose", appName: row.appName, serverId: row.serverId };
};

const applicationOwner = async (
	applicationId: string,
	organizationId: string,
): Promise<MountOwner> => {
	const application = await assertApplicationAccess(applicationId, organizationId);
	return {
		kind: "application",
		appName: application.appName,
		serverId: application.serverId,
		application,
	};
};

/** Load a mount of either kind and verify org ownership through its parent. */
const findMount = async (mountId: string, organizationId: string) => {
	const mount = await db.query.mounts.findFirst({ where: eq(mounts.mountId, mountId) });
	if (!mount) throw notFound("Mount not found");
	if (mount.serviceType === "compose" && mount.composeId) {
		return { mount, owner: await composeOwner(mount.composeId, organizationId) };
	}
	if (mount.serviceType === "application" && mount.applicationId) {
		return { mount, owner: await applicationOwner(mount.applicationId, organizationId) };
	}
	// Databases carry mount FKs in the schema but have no mount UI or router.
	throw notFound("Mount not found");
};

/**
 * Re-apply the change to what is running. An application's Swarm spec can take
 * a new mount immediately; a compose stack cannot — its file is rendered at
 * deploy time, so the change lands on the next deploy and the UI says so.
 */
const applyMountChange = async (owner: MountOwner): Promise<void> => {
	if (owner.kind === "application" && owner.application) {
		await upsertApplicationSwarmService(owner.application);
	}
};

export const mountRouter = router({
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			const rows = await db.query.mounts.findMany({
				where: and(
					eq(mounts.applicationId, input.applicationId),
					eq(mounts.serviceType, "application"),
				),
				orderBy: mounts.createdAt,
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			if (canSeeSecrets) return rows;
			return rows.map((row) => ({ ...row, content: null, secretsRedacted: true }));
		}),

	byCompose: protectedProcedure
		.input(z.object({ composeId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await findComposeForOrg(input.composeId, organizationId);
			const rows = await db.query.mounts.findMany({
				where: and(eq(mounts.composeId, input.composeId), eq(mounts.serviceType, "compose")),
				orderBy: mounts.createdAt,
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			if (canSeeSecrets) return rows;
			return rows.map((row) => ({ ...row, content: null, secretsRedacted: true }));
		}),

	one: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { mount } = await findMount(input.mountId, organizationId);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? mount : { ...mount, content: null, secretsRedacted: true };
		}),

	create: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
					/** Compose only: which service of the stack gets the mount. */
					serviceName: z.string().min(1).max(63).optional(),
					...mountFields,
				})
				.refine(
					(value) => Boolean(value.applicationId) !== Boolean(value.composeId),
					"Pass exactly one of applicationId or composeId",
				)
				.refine(
					(value) => !value.composeId || Boolean(value.serviceName),
					"serviceName is required for a compose mount — a stack has more than one container",
				),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.type === "file" && input.content !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			// Bind mounts can expose arbitrary host trees — instance admin only.
			if (input.type === "bind") {
				await assertInstanceAdmin(ctx.session);
			}
			const owner = input.composeId
				? await composeOwner(input.composeId, organizationId)
				: await applicationOwner(input.applicationId ?? "", organizationId);
			validateMountFields(input);
			if (input.type === "bind") await assertSafeHostPath(input.hostPath);
			if (input.type === "volume") assertSafeVolumeName(input.volumeName, owner.appName);
			if (input.type === "file") assertSafeFilePath(owner.appName, input.filePath);

			const [mount] = await db
				.insert(mounts)
				.values({
					type: input.type,
					mountPath: input.mountPath,
					hostPath: input.type === "bind" ? (input.hostPath ?? null) : null,
					volumeName: input.type === "volume" ? (input.volumeName ?? null) : null,
					filePath: input.type === "file" ? (input.filePath ?? null) : null,
					content: input.type === "file" ? (input.content ?? null) : null,
					serviceName: input.composeId ? (input.serviceName ?? null) : null,
					serviceType: input.composeId ? "compose" : "application",
					applicationId: input.applicationId ?? null,
					composeId: input.composeId ?? null,
				})
				.returning();
			if (!mount) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create mount",
				});
			}

			// The bind source must exist on the server the task runs on — the
			// deploy engine only resolves the path, it never writes the file.
			if (mount.type === "file" && mount.filePath) {
				await materializeFileMount(
					owner.appName,
					mount.filePath,
					mount.content ?? "",
					owner.serverId,
				);
			}
			await applyMountChange(owner);
			await auditFromSession(ctx, organizationId, {
				action: "mount.create",
				targetType: "mount",
				targetId: mount.mountId,
				targetName: mount.mountPath,
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? mount : { ...mount, content: null, secretsRedacted: true };
		}),

	update: protectedProcedure
		.input(
			z.object({
				mountId: z.string().min(1),
				type: mountFields.type.optional(),
				mountPath: mountFields.mountPath.optional(),
				hostPath: mountFields.hostPath,
				volumeName: mountFields.volumeName,
				filePath: mountFields.filePath,
				content: mountFields.content,
				/** Compose only: move the mount to another service of the stack. */
				serviceName: z.string().min(1).max(63).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.content !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			const { mount, owner } = await findMount(input.mountId, organizationId);

			const next = {
				type: input.type ?? mount.type,
				mountPath: input.mountPath ?? mount.mountPath,
				hostPath: input.hostPath !== undefined ? input.hostPath : mount.hostPath,
				volumeName: input.volumeName !== undefined ? input.volumeName : mount.volumeName,
				filePath: input.filePath !== undefined ? input.filePath : mount.filePath,
				content: input.content !== undefined ? input.content : mount.content,
			};
			if (next.type === "bind" || mount.type === "bind") {
				await assertInstanceAdmin(ctx.session);
			}
			validateMountFields(next);
			if (next.type === "bind") await assertSafeHostPath(next.hostPath);
			if (next.type === "volume") assertSafeVolumeName(next.volumeName, owner.appName);
			if (next.type === "file") assertSafeFilePath(owner.appName, next.filePath);

			const [updated] = await db
				.update(mounts)
				.set({
					type: next.type,
					mountPath: next.mountPath,
					// Only a compose mount has one; an application ignores it.
					serviceName: owner.kind === "compose" ? (input.serviceName ?? mount.serviceName) : null,
					hostPath: next.type === "bind" ? next.hostPath : null,
					volumeName: next.type === "volume" ? next.volumeName : null,
					filePath: next.type === "file" ? next.filePath : null,
					content: next.type === "file" ? next.content : null,
				})
				.where(eq(mounts.mountId, mount.mountId))
				.returning();

			// Clean up the old backing file when the mount no longer uses it.
			if (
				mount.type === "file" &&
				mount.filePath &&
				(next.type !== "file" || next.filePath !== mount.filePath)
			) {
				await removeFileMount(owner.appName, mount.filePath, owner.serverId);
			}
			if (next.type === "file" && next.filePath) {
				await materializeFileMount(
					owner.appName,
					next.filePath,
					next.content ?? "",
					owner.serverId,
				);
			}
			await applyMountChange(owner);
			await auditFromSession(ctx, organizationId, {
				action: "mount.update",
				targetType: "mount",
				targetId: mount.mountId,
				targetName: next.mountPath,
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets || !updated
				? updated
				: { ...updated, content: null, secretsRedacted: true };
		}),

	delete: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { mount, owner } = await findMount(input.mountId, organizationId);

			await db.delete(mounts).where(eq(mounts.mountId, mount.mountId));

			if (mount.type === "file" && mount.filePath) {
				await removeFileMount(owner.appName, mount.filePath, owner.serverId);
			}
			await applyMountChange(owner);
			await auditFromSession(ctx, organizationId, {
				action: "mount.delete",
				targetType: "mount",
				targetId: mount.mountId,
				targetName: mount.mountPath,
			});
			return { mountId: mount.mountId };
		}),
});
