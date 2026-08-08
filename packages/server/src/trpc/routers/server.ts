import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	createServer,
	findServerById,
	getServerStatsBatch,
	getServerStatsCached,
	listServersByOrganization,
	redactServerCommandLog,
	removeServer,
	setupServer,
	testConnection,
	updateServerById,
} from "../../modules/cluster";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { clearRemoteHostKey } from "../../utils/exec";
import { assertSshKeyInOrganization } from "../assert-org-refs";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Fetch a server row and verify it belongs to the caller's organization. */
async function findServerOrThrow(serverId: string, organizationId: string) {
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
	}
	return server;
}

const serverIdInput = z.object({ serverId: z.string().min(1) });

const createServerInput = z.object({
	name: z.string().min(1),
	description: z.string().nullish(),
	ipAddress: z.string().min(1),
	port: z.number().int().min(1).max(65535).optional(),
	username: z.string().min(1).optional(),
	sshKeyId: z.string().nullish(),
	swarmRole: z.enum(["worker", "manager"]).optional(),
});

/** Strip secrets from a server row before returning it to clients. */
function publicServer<T extends { command?: string | null }>(server: T): T {
	return {
		...server,
		command: redactServerCommandLog(server.command),
	};
}

export const serverRouter = router({
	/** All managed servers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listServersByOrganization(organizationId);
		return rows.map(publicServer);
	}),

	/** A single server by id. */
	one: protectedProcedure.input(serverIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return publicServer(await findServerOrThrow(input.serverId, organizationId));
	}),

	/** Register a new managed server (does not provision it; use `setup`). */
	create: protectedProcedure.input(createServerInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
		await assertSshKeyInOrganization(input.sshKeyId, organizationId);
		const created = await createServer(
			{
				name: input.name,
				description: input.description ?? null,
				ipAddress: input.ipAddress,
				port: input.port,
				username: input.username,
				sshKeyId: input.sshKeyId ?? null,
				swarmRole: input.swarmRole,
			},
			organizationId,
		);
		await auditFromSession(ctx, organizationId, {
			action: "server.create",
			targetType: "server",
			targetId: created?.serverId,
			targetName: created?.name ?? input.name,
		});
		return created ? publicServer(created) : created;
	}),

	/** Update connection details, status or the docker-cleanup toggle. */
	update: protectedProcedure
		.input(
			createServerInput.partial().extend({
				serverId: z.string().min(1),
				serverStatus: z.enum(["active", "inactive"]).optional(),
				enableDockerCleanup: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
			await findServerOrThrow(input.serverId, organizationId);
			await assertSshKeyInOrganization(input.sshKeyId, organizationId);
			const { serverId, ...values } = input;
			const updated = await updateServerById(serverId, values, organizationId);
			return updated ? publicServer(updated) : updated;
		}),

	/** Detach a server from the organization (does not touch the host). */
	remove: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
		const server = await findServerOrThrow(input.serverId, organizationId);
		const removed = await removeServer(input.serverId, organizationId);
		clearRemoteHostKey(input.serverId);
		await auditFromSession(ctx, organizationId, {
			action: "server.delete",
			targetType: "server",
			targetId: input.serverId,
			targetName: server.name,
		});
		return removed ? publicServer(removed) : removed;
	}),

	/** Verify SSH reachability and remote Docker availability. */
	testConnection: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
		await findServerOrThrow(input.serverId, organizationId);
		return await testConnection(input.serverId);
	}),

	/**
	 * Idempotent provisioning: install Docker, join the primary Swarm
	 * (worker or manager), and prepare Traefik dirs on managers. Returns the
	 * accumulated shell log (also persisted on the server row).
	 */
	setup: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
		await findServerOrThrow(input.serverId, organizationId);
		const command = await setupServer(input.serverId);
		return { command: redactServerCommandLog(command) };
	}),

	/** Live node metrics (docker, cpu, memory, disk, load) collected over SSH. */
	getStats: protectedProcedure.input(serverIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await findServerOrThrow(input.serverId, organizationId);
		return await getServerStatsCached(input.serverId);
	}),

	/**
	 * Batch capacity metrics for the servers table. Caps concurrent SSH at 4
	 * and reuses the 30s process cache so refreshes / multi-user views do not
	 * fan out again.
	 */
	getStatsBatch: protectedProcedure
		.input(z.object({ serverIds: z.array(z.string().min(1)).max(100) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const owned = await listServersByOrganization(organizationId);
			const ownedIds = new Set(owned.map((server) => server.serverId));
			const allowed = input.serverIds.filter((id) => ownedIds.has(id));
			return await getServerStatsBatch(allowed);
		}),
});
