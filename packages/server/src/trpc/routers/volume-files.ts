import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findServerById } from "../../modules/cluster/servers";
import {
	deleteVolumePath,
	listVolumeFiles,
	MAX_WRITE_BYTES,
	makeVolumeDirectory,
	readVolumeFile,
	writeVolumeFile,
} from "../../modules/docker/volume-files";
import { notFound } from "../../modules/errors";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/**
 * File browser for Docker volumes (`/dashboard/docker` → Volumes → Browse).
 *
 * Every procedure runs a throwaway container with the volume attached; the
 * mechanics, the path confinement and the hardening flags live in
 * `modules/docker/volume-files.ts`.
 *
 * Authorization matches the rest of the Docker control center and then some:
 * `docker.manage` plus, because a volume is an *instance-level* resource that
 * any org's service may own, the **instance-admin** role. A managed server's
 * `serverId` is still verified against the caller's organization before an
 * SSH command is sent to it.
 *
 * Separate router rather than more procedures on `docker`: the file browser
 * is a self-contained feature with its own audit actions, and `docker.ts` is
 * already 500 lines of control-center plumbing.
 */

const target = z.object({
	volumeName: z.string().min(1).max(255),
	serverId: z.string().nullish(),
});

const withPath = target.extend({
	/** Path inside the volume; empty means the volume root. */
	path: z.string().max(2048).nullish(),
});

const requiredPath = target.extend({
	path: z.string().min(1).max(2048),
});

type VolumeContext = {
	session: {
		user: { id: string; role?: string | null };
		session: { activeOrganizationId?: string | null };
	};
};

/**
 * `docker.manage` + instance admin, and a `serverId` (when given) that
 * belongs to the caller's org — the local docker socket sees every tenant's
 * volumes, and a remote is a Swarm member, so both are platform-level.
 */
async function assertVolumeAccess(ctx: VolumeContext, serverId?: string | null): Promise<string> {
	const organizationId = await resolveCallerOrganizationId(
		ctx.session.user.id,
		ctx.session.session.activeOrganizationId,
	);
	await assertCapability(ctx.session.user.id, organizationId, "docker.manage");
	await assertInstanceAdmin(ctx.session);
	if (serverId) {
		const server = await findServerById(serverId, organizationId);
		if (!server) {
			throw notFound("Server not found");
		}
	}
	return organizationId;
}

export const volumeFilesRouter = router({
	/** Directory listing inside a volume. */
	list: protectedProcedure.input(withPath).query(async ({ ctx, input }) => {
		await assertVolumeAccess(ctx, input.serverId);
		return await listVolumeFiles(
			{ volumeName: input.volumeName, serverId: input.serverId },
			input.path,
		);
	}),

	/** Contents of one text file (≤ 512 KiB; binary files are refused). */
	read: protectedProcedure.input(requiredPath).query(async ({ ctx, input }) => {
		await assertVolumeAccess(ctx, input.serverId);
		return await readVolumeFile(
			{ volumeName: input.volumeName, serverId: input.serverId },
			input.path,
		);
	}),

	/** Create or overwrite one text file. */
	write: protectedProcedure
		.input(
			requiredPath.extend({
				// Zod caps the *string length*; the module caps the UTF-8 byte
				// length, which is the one the container enforces.
				content: z.string().max(MAX_WRITE_BYTES),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertVolumeAccess(ctx, input.serverId);
			const result = await writeVolumeFile(
				{ volumeName: input.volumeName, serverId: input.serverId },
				input.path,
				input.content,
			);
			void auditFromSession(ctx, organizationId, {
				action: "docker.volume.file.write",
				targetType: "volume",
				targetName: input.volumeName,
				metadata: { path: result.path, bytes: result.size, serverId: input.serverId ?? null },
			});
			return result;
		}),

	/** Delete a file, or a directory and everything under it. */
	delete: protectedProcedure.input(requiredPath).mutation(async ({ ctx, input }) => {
		const organizationId = await assertVolumeAccess(ctx, input.serverId);
		const result = await deleteVolumePath(
			{ volumeName: input.volumeName, serverId: input.serverId },
			input.path,
		);
		void auditFromSession(ctx, organizationId, {
			action: "docker.volume.file.delete",
			targetType: "volume",
			targetName: input.volumeName,
			metadata: { path: result.path, serverId: input.serverId ?? null },
		});
		return result;
	}),

	/** Create one directory (its parent must already exist). */
	mkdir: protectedProcedure.input(requiredPath).mutation(async ({ ctx, input }) => {
		const organizationId = await assertVolumeAccess(ctx, input.serverId);
		const result = await makeVolumeDirectory(
			{ volumeName: input.volumeName, serverId: input.serverId },
			input.path,
		);
		void auditFromSession(ctx, organizationId, {
			action: "docker.volume.file.mkdir",
			targetType: "volume",
			targetName: input.volumeName,
			metadata: { path: result.path, serverId: input.serverId ?? null },
		});
		return result;
	}),
});
