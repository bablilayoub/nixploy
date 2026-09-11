import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findServerById } from "../../modules/cluster/servers";
import {
	dockerListingCache,
	dockerListingKey,
	invalidateDockerListings,
} from "../../modules/docker/containers";
import {
	isProtectedContainerNames,
	isProtectedPlatformName,
	PROTECTED_NETWORKS,
	PROTECTED_VOLUMES,
} from "../../modules/docker/protected";
import {
	isGuardedVolumeName,
	listServiceVolumeGuard,
	pruneUnusedVolumes,
} from "../../modules/docker/prune";
import { emitDockerCleanupNotification } from "../../modules/notifications";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { assertSafeDockerImageRef } from "../../utils/validators";
import { protectedProcedure, router } from "../init";

/**
 * Docker control center: containers, images, swarm services/nodes, networks,
 * volumes and system info — on the Nixploy host or a managed server
 * (`serverId`). All commands run through the docker CLI with `--format
 * '{{json .}}'` for robust parsing; mutations require the admin role.
 */

const serverInput = z.object({ serverId: z.string().nullish() });

/**
 * Read-only docker listings, cached for 10 s per (view, server) and shared by
 * concurrent callers (audit #14). The Docker tab polls `containers` every
 * 30 s, the compose runtime view every 15 s and so on — *per open tab* —
 * which used to mean one `docker ps` / SSH round-trip each. Authorization
 * always runs BEFORE the lookup; the cached payload is server-scoped, never
 * caller-scoped.
 *
 * The cache itself lives in `modules/docker/containers.ts` so the deploy
 * worker can invalidate a server's entries when it changes what runs there.
 */
const cachedListing = (
	ctx: DockerContext,
	view: string,
	serverId: string | null | undefined,
	command: string,
): Promise<string> =>
	dockerListingCache.get(dockerListingKey(view, serverId), () => runOn(ctx, serverId, command));

type DockerContext = {
	session: { user: { id: string }; session: { activeOrganizationId?: string | null } };
};

/**
 * Run a docker command locally, or over SSH on a managed server after
 * verifying that server belongs to the caller's organization — `serverId`
 * comes from the client and would otherwise reach another tenant's host.
 */
async function runOn(
	ctx: DockerContext,
	serverId: string | null | undefined,
	command: string,
): Promise<string> {
	if (!serverId) {
		return await execAsync(command);
	}
	const organizationId = await resolveOrg(ctx);
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
	}
	return await execAsyncRemote(serverId, command);
}

/** Parse `docker ... --format '{{json .}}'` output (one JSON object per line). */
function parseJsonLines<T>(output: string): T[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

async function resolveOrg(ctx: {
	session: { user: { id: string }; session: { activeOrganizationId?: string | null } };
}) {
	return await resolveCallerOrganizationId(
		ctx.session.user.id,
		ctx.session.session.activeOrganizationId,
	);
}

type AdminContext = {
	session: {
		user: { id: string; role?: string | null };
		session: { activeOrganizationId?: string | null };
	};
};

async function assertAdmin(ctx: AdminContext, serverId?: string | null) {
	const organizationId = await resolveOrg(ctx);
	await assertCapability(ctx.session.user.id, organizationId, "docker.manage");
	if (!serverId) {
		// Local docker.sock sees every org's containers — instance admins only.
		await assertInstanceAdmin(ctx.session);
	}
	return organizationId;
}

/**
 * Swarm nodes/services and system prune are cluster-wide: managed servers
 * join the PRIMARY swarm, so a manager-role remote's engine can drain the
 * primary node or list every tenant's services. Instance admins only, with
 * or without a `serverId`.
 */
async function assertClusterAdmin(ctx: AdminContext, serverId?: string | null) {
	const organizationId = await assertAdmin(ctx, serverId);
	await assertInstanceAdmin(ctx.session);
	return organizationId;
}

/**
 * Swarm services and nodes are cluster-scoped objects that only a manager
 * can read or change. Managed servers are usually workers, so the swarm
 * views always run on the PRIMARY engine — `serverId` is still checked
 * against the caller's org (the tab was opened for that server) but never
 * used as the command target.
 */
async function runSwarmOnPrimary(
	ctx: DockerContext,
	serverId: string | null | undefined,
	command: string,
): Promise<string> {
	if (serverId) {
		const organizationId = await resolveOrg(ctx);
		const server = await findServerById(serverId, organizationId);
		if (!server) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
		}
	}
	return await execAsync(command);
}

/** `docker node|service ...` on a worker or non-swarm engine: an empty tab, not an error. */
function isNotSwarmManagerError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const stderr = (error as { stderr?: string }).stderr ?? "";
	return /not a swarm manager|This node is not a swarm manager|not part of a swarm/i.test(
		`${message}\n${stderr}`,
	);
}

export const dockerRouter = router({
	// ── Containers ────────────────────────────────────────────────────────────

	containers: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertAdmin(ctx, input?.serverId);
		const out = await cachedListing(
			ctx,
			"containers",
			input.serverId,
			`docker ps -a --format '{{json .}}'`,
		);
		return parseJsonLines<{
			ID: string;
			Image: string;
			Names: string;
			State: string;
			Status: string;
			Ports: string;
			CreatedAt: string;
			Labels: string;
		}>(out).map((row) => ({
			...row,
			protected: isProtectedContainerNames(row.Names),
		}));
	}),

	containerAction: protectedProcedure
		.input(
			serverInput.extend({
				containerId: z.string().min(1),
				action: z.enum(["start", "stop", "restart", "remove"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertAdmin(ctx, input.serverId);
			// Resolve the live name — the client only sends an ID, and a
			// protected container must not be stoppable/removable from the UI.
			const inspected = (
				await runOn(
					ctx,
					input.serverId,
					`docker inspect --format '{{.Name}}' ${shq(input.containerId)}`,
				)
			).trim();
			if (isProtectedPlatformName(inspected)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Container "${inspected.replace(/^\//, "")}" is a Nixploy platform service and cannot be ${input.action}ed from here`,
				});
			}
			const command =
				input.action === "remove"
					? `docker rm -f ${shq(input.containerId)}`
					: `docker ${input.action} ${shq(input.containerId)}`;
			await runOn(ctx, input.serverId, command);
			invalidateDockerListings(input.serverId);
			if (input.action === "remove") {
				await auditFromSession(ctx, organizationId, {
					action: "docker.container.remove",
					targetType: "container",
					targetName: input.containerId,
				});
			}
			return true;
		}),

	// ── Images ────────────────────────────────────────────────────────────────

	images: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertAdmin(ctx, input?.serverId);
		const out = await cachedListing(
			ctx,
			"images",
			input.serverId,
			`docker images --format '{{json .}}'`,
		);
		return parseJsonLines<{
			Repository: string;
			Tag: string;
			ID: string;
			Size: string;
			CreatedSince: string;
		}>(out);
	}),

	imagePull: protectedProcedure
		.input(serverInput.extend({ reference: z.string().min(1).max(512) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx, input?.serverId);
			const reference = assertSafeDockerImageRef(input.reference);
			const output = await runOn(ctx, input.serverId, `docker pull ${shq(reference)}`);
			invalidateDockerListings(input.serverId);
			return output;
		}),

	imageRemove: protectedProcedure
		.input(serverInput.extend({ imageId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx, input?.serverId);
			await runOn(ctx, input.serverId, `docker rmi ${shq(input.imageId)}`);
			invalidateDockerListings(input.serverId);
			return true;
		}),

	imagesPrune: protectedProcedure
		.input(serverInput.extend({ all: z.boolean().default(false) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertAdmin(ctx, input?.serverId);
			const output = await runOn(
				ctx,
				input.serverId,
				`docker image prune -f ${input.all ? "-a" : ""}`.trim(),
			);
			invalidateDockerListings(input.serverId);
			void emitDockerCleanupNotification(organizationId, {
				scope: "images",
				serverId: input.serverId ?? null,
				actor: ctx.session.user.email,
				output,
			});
			return output;
		}),

	// ── Swarm ─────────────────────────────────────────────────────────────────

	swarmServices: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertClusterAdmin(ctx, input?.serverId);
		let out: string;
		try {
			out = await dockerListingCache.get(dockerListingKey("swarmServices", input.serverId), () =>
				runSwarmOnPrimary(ctx, input.serverId, `docker service ls --format '{{json .}}'`),
			);
		} catch (error) {
			if (isNotSwarmManagerError(error)) return [];
			throw error;
		}
		return parseJsonLines<{
			ID: string;
			Name: string;
			Mode: string;
			Replicas: string;
			Image: string;
			Ports: string;
		}>(out).map((row) => ({
			...row,
			protected: isProtectedPlatformName(row.Name),
		}));
	}),

	nodes: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertClusterAdmin(ctx, input?.serverId);
		let out: string;
		try {
			out = await runSwarmOnPrimary(ctx, input.serverId, `docker node ls --format '{{json .}}'`);
		} catch (error) {
			if (isNotSwarmManagerError(error)) return [];
			throw error;
		}
		return parseJsonLines<{
			ID: string;
			Hostname: string;
			Status: string;
			Availability: string;
			ManagerStatus: string;
			EngineVersion: string;
		}>(out);
	}),

	nodeUpdate: protectedProcedure
		.input(
			serverInput.extend({
				nodeId: z.string().min(1),
				availability: z.enum(["active", "pause", "drain"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertClusterAdmin(ctx, input?.serverId);
			await runSwarmOnPrimary(
				ctx,
				input.serverId,
				`docker node update --availability ${input.availability} ${shq(input.nodeId)}`,
			);
			invalidateDockerListings(input.serverId);
			void auditFromSession(ctx, organizationId, {
				action: "docker.node.update",
				targetType: "node",
				targetId: input.nodeId,
				metadata: { availability: input.availability },
			});
			return true;
		}),

	// ── Networks ──────────────────────────────────────────────────────────────

	networks: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertAdmin(ctx, input?.serverId);
		const out = await runOn(ctx, input.serverId, `docker network ls --format '{{json .}}'`);
		return parseJsonLines<{
			ID: string;
			Name: string;
			Driver: string;
			Scope: string;
		}>(out).map((row) => ({
			...row,
			protected: PROTECTED_NETWORKS.has(row.Name),
		}));
	}),

	networkRemove: protectedProcedure
		.input(serverInput.extend({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx, input?.serverId);
			if (PROTECTED_NETWORKS.has(input.name)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Network "${input.name}" is required by Nixploy or Docker and cannot be removed`,
				});
			}
			await runOn(ctx, input.serverId, `docker network rm ${shq(input.name)}`);
			return true;
		}),

	// ── Volumes ───────────────────────────────────────────────────────────────

	volumes: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertAdmin(ctx, input?.serverId);
		const [out, guard] = await Promise.all([
			runOn(ctx, input.serverId, `docker volume ls --format '{{json .}}'`),
			listServiceVolumeGuard(),
		]);
		return parseJsonLines<{
			Name: string;
			Driver: string;
			Mountpoint: string;
		}>(out).map((row) => ({
			...row,
			protected: isGuardedVolumeName(row.Name, guard),
		}));
	}),

	volumeRemove: protectedProcedure
		.input(serverInput.extend({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertAdmin(ctx, input?.serverId);
			if (PROTECTED_VOLUMES.has(input.name)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Volume "${input.name}" is required by Nixploy and cannot be removed`,
				});
			}
			// A stopped service (scaled to zero) has no container holding its
			// volume, so docker would happily delete its data — refuse here.
			if (isGuardedVolumeName(input.name, await listServiceVolumeGuard())) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Volume "${input.name}" belongs to a Nixploy service — delete the service instead`,
				});
			}
			// In-use volumes are rejected by docker itself; the message surfaces.
			await runOn(ctx, input.serverId, `docker volume rm ${shq(input.name)}`);
			void auditFromSession(ctx, organizationId, {
				action: "docker.volume.remove",
				targetType: "volume",
				targetName: input.name,
			});
			return true;
		}),

	volumesPrune: protectedProcedure.input(serverInput).mutation(async ({ ctx, input }) => {
		const organizationId = await assertAdmin(ctx, input?.serverId);
		// Docker 23+ `volume prune -f` only removes anonymous volumes; remove
		// named unused volumes too while keeping platform + service volumes safe.
		// Service specs (mounted volume names) are read from the primary manager.
		const output = await pruneUnusedVolumes(
			(command) => runOn(ctx, input.serverId, command),
			await listServiceVolumeGuard(),
			execAsync,
		);
		void auditFromSession(ctx, organizationId, { action: "docker.volumes.prune" });
		void emitDockerCleanupNotification(organizationId, {
			scope: "volumes",
			serverId: input.serverId ?? null,
			actor: ctx.session.user.email,
			output,
		});
		return output;
	}),

	// ── System ────────────────────────────────────────────────────────────────

	systemInfo: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		await assertAdmin(ctx, input?.serverId);
		const [version, df] = await Promise.all([
			runOn(ctx, input.serverId, `docker version --format '{{json .}}'`),
			runOn(ctx, input.serverId, `docker system df --format '{{json .}}'`),
		]);
		return {
			version: JSON.parse(version.trim()) as {
				Server?: { Version?: string; Os?: string; Arch?: string };
				Client?: { Version?: string };
			},
			df: parseJsonLines<{
				Type: string;
				TotalCount: string;
				Active: string;
				Size: string;
				Reclaimable: string;
			}>(df),
		};
	}),

	systemPrune: protectedProcedure
		.input(serverInput.extend({ volumes: z.boolean().default(false) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await assertClusterAdmin(ctx, input.serverId);
			const run = (command: string) => runOn(ctx, input.serverId, command);
			// Volumes go through the guarded pass below instead of `--volumes`,
			// so data volumes of stopped (scaled-to-zero) services survive.
			const systemOut = await run("docker system prune -f");
			invalidateDockerListings(input.serverId);
			const volumeOut = input.volumes
				? await pruneUnusedVolumes(run, await listServiceVolumeGuard(), execAsync)
				: "";
			await auditFromSession(ctx, organizationId, {
				action: "docker.system.prune",
				metadata: { volumes: input.volumes },
			});
			const output = [systemOut, volumeOut].filter(Boolean).join("\n");
			void emitDockerCleanupNotification(organizationId, {
				scope: "system",
				serverId: input.serverId ?? null,
				actor: ctx.session.user.email,
				output,
			});
			return output;
		}),
});
