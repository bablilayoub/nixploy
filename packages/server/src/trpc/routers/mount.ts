import { realpath } from "node:fs/promises";
import path from "node:path";
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
import { resolveFileMountPath } from "../../modules/application/paths";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { PROTECTED_VOLUMES } from "../../modules/docker/protected";
import { assertCapability, hasCapability } from "../../modules/projects";
import { getConfigDir } from "../../modules/traefik/paths";
import { mountContentSchema } from "../../utils/input-limits";
import { assertDockerVolumeName } from "../../utils/validators";
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

const BLOCKED_HOST_PATH_PREFIXES = [
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/etc",
	"/root",
	"/proc",
	"/sys",
	"/boot",
	"/dev",
	"/tmp",
	"/var",
	"/run",
	"/home",
	"/Users",
	"/usr",
	"/opt",
	"/srv",
	"/mnt",
	"/media",
	"/data",
	"/nix",
	"/workspace",
	"/Applications",
	"/Library",
	"/System",
	"/private",
] as const;

/**
 * Reject bind mounts that would expose host secrets or the Docker socket.
 * Resolve symlinks via realpath (when the path exists) so `/tmp/sock → docker.sock`
 * cannot bypass the prefix denylist.
 */
const assertSafeHostPath = async (hostPath: string | null | undefined) => {
	if (!hostPath) return;
	if (hostPath.includes("\0")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "hostPath must not contain null bytes",
		});
	}
	if (!path.isAbsolute(hostPath)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "hostPath must be an absolute path",
		});
	}

	let candidate = path.resolve(hostPath);
	const missing: string[] = [];
	while (candidate !== "/") {
		try {
			candidate = await realpath(candidate);
			break;
		} catch {
			missing.unshift(path.basename(candidate));
			const parent = path.dirname(candidate);
			if (parent === candidate) break;
			candidate = parent;
		}
	}
	if (missing.length > 0) {
		try {
			candidate = path.join(await realpath(candidate), ...missing);
		} catch {
			candidate = path.join(candidate, ...missing);
		}
	}
	const normalized = path.resolve(candidate).replace(/\/+$/, "") || "/";
	if (normalized === "/") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Bind mount hostPath cannot be the filesystem root",
		});
	}
	const blockedPrefixes = [...BLOCKED_HOST_PATH_PREFIXES, path.resolve(getConfigDir())];
	for (const blocked of blockedPrefixes) {
		const blockedNorm = path.resolve(blocked).replace(/\/+$/, "") || "/";
		if (normalized === blockedNorm || normalized.startsWith(`${blockedNorm}/`)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Bind mount hostPath is not allowed: ${blockedNorm}`,
			});
		}
	}
};

/** Validate that the fields required by the mount type are present. */
const validateMountFields = (input: {
	type: "bind" | "volume" | "file";
	hostPath?: string | null;
	volumeName?: string | null;
	filePath?: string | null;
}) => {
	if (input.type === "bind" && !input.hostPath) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "hostPath is required for bind mounts",
		});
	}
	if (input.type === "volume" && !input.volumeName) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "volumeName is required for volume mounts",
		});
	}
	if (input.type === "file" && !input.filePath) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "filePath is required for file mounts",
		});
	}
};

const assertSafeVolumeName = (volumeName: string | null | undefined, appName: string) => {
	if (!volumeName) return;
	assertDockerVolumeName(volumeName);
	if (PROTECTED_VOLUMES.has(volumeName)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `Volume "${volumeName}" is a Nixploy platform volume and cannot be mounted`,
		});
	}
	// Prevent cross-tenant attach: only volumes owned by this app.
	const owned =
		volumeName === appName ||
		volumeName.startsWith(`${appName}_`) ||
		volumeName.startsWith(`${appName}-`);
	if (!owned) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Volume "${volumeName}" must be scoped to this application (name "${appName}", or prefix "${appName}_" / "${appName}-")`,
		});
	}
};

/** Reject file mount paths that escape the application's files directory. */
const assertSafeFilePath = (appName: string, filePath: string | null | undefined) => {
	if (!filePath) return;
	try {
		resolveFileMountPath(appName, filePath);
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid file mount path: ${filePath}`,
		});
	}
};

/** Load an application-owned mount and verify org ownership. */
const findApplicationMount = async (mountId: string, organizationId: string) => {
	const mount = await db.query.mounts.findFirst({
		where: and(eq(mounts.mountId, mountId), eq(mounts.serviceType, "application")),
	});
	if (!mount?.applicationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Mount not found" });
	}
	const application = await assertApplicationAccess(mount.applicationId, organizationId);
	return { mount, application };
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
			return rows.map((row) => ({ ...row, content: null }));
		}),

	one: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { mount } = await findApplicationMount(input.mountId, organizationId);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? mount : { ...mount, content: null };
		}),

	create: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1), ...mountFields }))
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
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			validateMountFields(input);
			if (input.type === "bind") await assertSafeHostPath(input.hostPath);
			if (input.type === "volume") assertSafeVolumeName(input.volumeName, application.appName);
			if (input.type === "file") assertSafeFilePath(application.appName, input.filePath);

			const [mount] = await db
				.insert(mounts)
				.values({
					type: input.type,
					mountPath: input.mountPath,
					hostPath: input.type === "bind" ? (input.hostPath ?? null) : null,
					volumeName: input.type === "volume" ? (input.volumeName ?? null) : null,
					filePath: input.type === "file" ? (input.filePath ?? null) : null,
					content: input.type === "file" ? (input.content ?? null) : null,
					serviceType: "application",
					applicationId: input.applicationId,
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
					application.appName,
					mount.filePath,
					mount.content ?? "",
					application.serverId,
				);
			}
			await upsertApplicationSwarmService(application);
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
			return canSeeSecrets ? mount : { ...mount, content: null };
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.content !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			const { mount, application } = await findApplicationMount(input.mountId, organizationId);

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
			if (next.type === "volume") assertSafeVolumeName(next.volumeName, application.appName);
			if (next.type === "file") assertSafeFilePath(application.appName, next.filePath);

			const [updated] = await db
				.update(mounts)
				.set({
					type: next.type,
					mountPath: next.mountPath,
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
				await removeFileMount(application.appName, mount.filePath, application.serverId);
			}
			if (next.type === "file" && next.filePath) {
				await materializeFileMount(
					application.appName,
					next.filePath,
					next.content ?? "",
					application.serverId,
				);
			}
			await upsertApplicationSwarmService(application);
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
			return canSeeSecrets || !updated ? updated : { ...updated, content: null };
		}),

	delete: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { mount, application } = await findApplicationMount(input.mountId, organizationId);

			await db.delete(mounts).where(eq(mounts.mountId, mount.mountId));

			if (mount.type === "file" && mount.filePath) {
				await removeFileMount(application.appName, mount.filePath, application.serverId);
			}
			await upsertApplicationSwarmService(application);
			await auditFromSession(ctx, organizationId, {
				action: "mount.delete",
				targetType: "mount",
				targetId: mount.mountId,
				targetName: mount.mountPath,
			});
			return { mountId: mount.mountId };
		}),
});
