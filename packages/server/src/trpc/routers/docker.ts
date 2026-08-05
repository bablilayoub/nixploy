import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { findServerById } from "../../modules/cluster/servers";
import {
	isProtectedContainerNames,
	isProtectedPlatformName,
	PROTECTED_NETWORKS,
	PROTECTED_VOLUMES,
} from "../../modules/docker/protected";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { protectedProcedure, router } from "../init";

/**
 * Docker control center: containers, images, swarm services/nodes, networks,
 * volumes and system info — on the Nixploy host or a managed server
 * (`serverId`). All commands run through the docker CLI with `--format
 * '{{json .}}'` for robust parsing; mutations require the admin role.
 */

const serverInput = z.object({ serverId: z.string().nullish() });

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

async function assertAdmin(ctx: {
	session: { user: { id: string }; session: { activeOrganizationId?: string | null } };
}) {
	const organizationId = await resolveOrg(ctx);
	await assertOrgRole(ctx.session.user.id, organizationId, "admin");
	return organizationId;
}

export const dockerRouter = router({
	// ── Containers ────────────────────────────────────────────────────────────

	containers: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		const out = await runOn(ctx, input.serverId, `docker ps -a --format '{{json .}}'`);
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
			const organizationId = await assertAdmin(ctx);
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
		const out = await runOn(ctx, input.serverId, `docker images --format '{{json .}}'`);
		return parseJsonLines<{
			Repository: string;
			Tag: string;
			ID: string;
			Size: string;
			CreatedSince: string;
		}>(out);
	}),

	imagePull: protectedProcedure
		.input(serverInput.extend({ reference: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx);
			return await runOn(ctx, input.serverId, `docker pull ${shq(input.reference)}`);
		}),

	imageRemove: protectedProcedure
		.input(serverInput.extend({ imageId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx);
			await runOn(ctx, input.serverId, `docker rmi ${shq(input.imageId)}`);
			return true;
		}),

	imagesPrune: protectedProcedure
		.input(serverInput.extend({ all: z.boolean().default(false) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx);
			return await runOn(
				ctx,
				input.serverId,
				`docker image prune -f ${input.all ? "-a" : ""}`.trim(),
			);
		}),

	// ── Swarm ─────────────────────────────────────────────────────────────────

	swarmServices: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
		const out = await runOn(ctx, input.serverId, `docker service ls --format '{{json .}}'`);
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
		const out = await runOn(ctx, input.serverId, `docker node ls --format '{{json .}}'`);
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
			await assertAdmin(ctx);
			await runOn(
				ctx,
				input.serverId,
				`docker node update --availability ${input.availability} ${shq(input.nodeId)}`,
			);
			return true;
		}),

	// ── Networks ──────────────────────────────────────────────────────────────

	networks: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
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
			await assertAdmin(ctx);
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
		const out = await runOn(ctx, input.serverId, `docker volume ls --format '{{json .}}'`);
		return parseJsonLines<{
			Name: string;
			Driver: string;
			Mountpoint: string;
		}>(out).map((row) => ({
			...row,
			protected: PROTECTED_VOLUMES.has(row.Name),
		}));
	}),

	volumeRemove: protectedProcedure
		.input(serverInput.extend({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await assertAdmin(ctx);
			if (PROTECTED_VOLUMES.has(input.name)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Volume "${input.name}" is required by Nixploy and cannot be removed`,
				});
			}
			// In-use volumes are rejected by docker itself; the message surfaces.
			await runOn(ctx, input.serverId, `docker volume rm ${shq(input.name)}`);
			return true;
		}),

	volumesPrune: protectedProcedure.input(serverInput).mutation(async ({ ctx, input }) => {
		await assertAdmin(ctx);
		return await runOn(ctx, input.serverId, `docker volume prune -f`);
	}),

	// ── System ────────────────────────────────────────────────────────────────

	systemInfo: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
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
			const organizationId = await assertAdmin(ctx);
			const output = await runOn(
				ctx,
				input.serverId,
				`docker system prune -f ${input.volumes ? "--volumes" : ""}`.trim(),
			);
			await auditFromSession(ctx, organizationId, {
				action: "docker.system.prune",
				metadata: { volumes: input.volumes },
			});
			return output;
		}),
});
