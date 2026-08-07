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
import { assertCapability, assertOrgRole } from "../../modules/projects";
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
	/** file: content written to `filePath`. */
	content: z.string().nullable().optional(),
} as const;

const BLOCKED_HOST_PATH_PREFIXES = [
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/etc/nixploy",
	"/etc/shadow",
	"/etc/passwd",
	"/root",
	"/proc",
	"/sys",
] as const;

/** Reject bind mounts that would expose host secrets or the Docker socket. */
const assertSafeHostPath = (hostPath: string | null | undefined) => {
	if (!hostPath) return;
	const normalized = hostPath.replace(/\/+$/, "") || "/";
	for (const blocked of BLOCKED_HOST_PATH_PREFIXES) {
		if (normalized === blocked || normalized.startsWith(`${blocked}/`)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Bind mount hostPath is not allowed: ${blocked}`,
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
			return db.query.mounts.findMany({
				where: and(
					eq(mounts.applicationId, input.applicationId),
					eq(mounts.serviceType, "application"),
				),
				orderBy: mounts.createdAt,
			});
		}),

	one: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { mount } = await findApplicationMount(input.mountId, organizationId);
			return mount;
		}),

	create: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1), ...mountFields }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			validateMountFields(input);
			if (input.type === "bind") assertSafeHostPath(input.hostPath);

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

			// File mounts live on the nixploy host; remote servers get their
			// files materialized by the deploy engine.
			if (mount.type === "file" && mount.filePath && !application.serverId) {
				await materializeFileMount(application.appName, mount.filePath, mount.content ?? "");
			}
			await upsertApplicationSwarmService(application);
			return mount;
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
			const { mount, application } = await findApplicationMount(input.mountId, organizationId);

			const next = {
				type: input.type ?? mount.type,
				mountPath: input.mountPath ?? mount.mountPath,
				hostPath: input.hostPath !== undefined ? input.hostPath : mount.hostPath,
				volumeName: input.volumeName !== undefined ? input.volumeName : mount.volumeName,
				filePath: input.filePath !== undefined ? input.filePath : mount.filePath,
				content: input.content !== undefined ? input.content : mount.content,
			};
			validateMountFields(next);
			if (next.type === "bind") assertSafeHostPath(next.hostPath);

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

			if (!application.serverId) {
				// Clean up the old backing file when the mount no longer uses it.
				if (
					mount.type === "file" &&
					mount.filePath &&
					(next.type !== "file" || next.filePath !== mount.filePath)
				) {
					await removeFileMount(application.appName, mount.filePath);
				}
				if (next.type === "file" && next.filePath) {
					await materializeFileMount(application.appName, next.filePath, next.content ?? "");
				}
			}
			await upsertApplicationSwarmService(application);
			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ mountId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { mount, application } = await findApplicationMount(input.mountId, organizationId);

			await db.delete(mounts).where(eq(mounts.mountId, mount.mountId));

			if (mount.type === "file" && mount.filePath && !application.serverId) {
				await removeFileMount(application.appName, mount.filePath);
			}
			await upsertApplicationSwarmService(application);
			return { mountId: mount.mountId };
		}),
});
