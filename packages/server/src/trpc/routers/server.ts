import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import {
	createServer,
	findServerById,
	getServerStatsBatch,
	getServerStatsCached,
	getServerTransport,
	listServersByOrganization,
	redactServerCommandLog,
	removeServer,
	setupServer,
	testConnection,
	type UpdateServerInput,
	updateServerById,
} from "../../modules/cluster";
import {
	assertCapability,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
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
	/**
	 * Defaults to `worker` (schema default). `manager` is instance-admin only:
	 * a manager of the primary Swarm sees and controls every tenant's services.
	 */
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
		if (input.swarmRole === "manager") {
			await assertInstanceAdmin(ctx.session);
		}
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

	/** Update connection details, status or the docker-cleanup/metrics toggles. */
	update: protectedProcedure
		.input(
			createServerInput.partial().extend({
				serverId: z.string().min(1),
				serverStatus: z.enum(["active", "inactive"]).optional(),
				enableDockerCleanup: z.boolean().optional(),
				/** Master switch for the SSH metrics-history sampling of this server. */
				metricsEnabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
			const existing = await findServerOrThrow(input.serverId, organizationId);
			// Promoting to manager is a cluster-wide grant (see `create`); an
			// unchanged `manager` on an admin-created row stays editable by the org.
			if (input.swarmRole === "manager" && existing.swarmRole !== "manager") {
				await assertInstanceAdmin(ctx.session);
			}
			await assertSshKeyInOrganization(input.sshKeyId, organizationId);
			const { serverId, metricsEnabled, ...values } = input;
			const update: UpdateServerInput = { ...values };
			if (metricsEnabled !== undefined) {
				const base =
					typeof existing.metricsConfig === "object" && existing.metricsConfig !== null
						? (existing.metricsConfig as Record<string, unknown>)
						: {};
				const metrics =
					typeof base.metrics === "object" && base.metrics !== null
						? (base.metrics as Record<string, unknown>)
						: {};
				update.metricsConfig = { ...base, metrics: { ...metrics, enabled: metricsEnabled } };
			}
			const updated = await updateServerById(serverId, update, organizationId);
			// Connection changes matter for audit: a swapped IP/key silently
			// re-targets every SSH command this server row drives.
			const changed = (["ipAddress", "port", "username", "sshKeyId", "swarmRole"] as const).filter(
				(key) => values[key] !== undefined && values[key] !== existing[key],
			);
			void auditFromSession(ctx, organizationId, {
				action: "server.update",
				targetType: "server",
				targetId: serverId,
				targetName: updated?.name ?? existing.name,
				metadata: {
					changed,
					...(values.serverStatus !== undefined && { serverStatus: values.serverStatus }),
				},
			});
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
	 *
	 * Instance admin only, whatever the role: the join token is read from the
	 * Nixploy host and the node becomes part of the *shared* Swarm. A manager
	 * can inspect and update every tenant's service (env included); even a
	 * worker runs other organizations' unpinned tasks as root, so an org admin
	 * joining a host they control could read them. `servers.manage` alone
	 * still covers registering, editing and removing the row.
	 */
	setup: protectedProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "servers.manage");
		await assertInstanceAdmin(ctx.session);
		const server = await findServerOrThrow(input.serverId, organizationId);
		const swarmRole = server.swarmRole === "manager" ? "manager" : "worker";
		const audit = (result: "ok" | "failed") =>
			auditFromSession(ctx, organizationId, {
				action: "server.setup",
				targetType: "server",
				targetId: server.serverId,
				targetName: server.name,
				metadata: { swarmRole, result },
			});
		let command: string;
		try {
			command = await setupServer(input.serverId, { instanceAdminVerified: true });
		} catch (error) {
			void audit("failed");
			throw error;
		}
		void audit("ok");
		return { command: redactServerCommandLog(command) };
	}),

	/** Live node metrics (docker, cpu, memory, disk, load) collected over SSH. */
	getStats: protectedProcedure.input(serverIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await findServerOrThrow(input.serverId, organizationId);
		return await getServerStatsCached(input.serverId);
	}),

	/**
	 * SSH transport health of the organization's servers: whether the panel
	 * holds a pooled connection, how many channels are open, and whether the
	 * circuit breaker is short-circuiting commands (`status: "unreachable"`).
	 *
	 * Process-local, like the deploy queue's slots — it describes what *this*
	 * panel process sees, not a stored column. `lastError` can name the host,
	 * so it is only returned to callers with `servers.manage`.
	 */
	transportState: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const owned = await listServersByOrganization(organizationId);
		const canManage = await hasCapability(ctx.session.user.id, organizationId, "servers.manage");
		return owned.map((server) => {
			const state = getServerTransport(server.serverId);
			return {
				...state,
				name: server.name,
				lastError: canManage ? state.lastError : null,
			};
		});
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
