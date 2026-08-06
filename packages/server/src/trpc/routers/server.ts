import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	createServer,
	findServerById,
	getServerStats,
	listServersByOrganization,
	removeServer,
	setupServer,
	testConnection,
	updateServerById,
} from "../../modules/cluster";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
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

export const serverRouter = router({
	/** All managed servers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await listServersByOrganization(organizationId);
	}),

	/** A single server by id. */
	one: protectedProcedure.input(serverIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await findServerOrThrow(input.serverId, organizationId);
	}),

	/** Register a new managed server (does not provision it; use `setup`). */
	create: protectedProcedure.input(createServerInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
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
		return created;
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
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			await findServerOrThrow(input.serverId, organizationId);
			const { serverId, ...values } = input;
			return await updateServerById(serverId, values, organizationId);
		}),

	/** Detach a server from the organization (does not touch the host). */
	remove: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const server = await findServerOrThrow(input.serverId, organizationId);
		const removed = await removeServer(input.serverId, organizationId);
		await auditFromSession(ctx, organizationId, {
			action: "server.delete",
			targetType: "server",
			targetId: input.serverId,
			targetName: server.name,
		});
		return removed;
	}),

	/** Verify SSH reachability and remote Docker availability. */
	testConnection: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
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
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		await findServerOrThrow(input.serverId, organizationId);
		const command = await setupServer(input.serverId);
		return { command };
	}),

	/** Live node metrics (docker, cpu, memory, disk, load) collected over SSH. */
	getStats: protectedProcedure.input(serverIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await findServerOrThrow(input.serverId, organizationId);
		return await getServerStats(input.serverId);
	}),
});
