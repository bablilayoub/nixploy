import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { traefikEntrypoints } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { conflict, isUniqueViolation, notFound } from "../../modules/errors";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	applyTraefikEntrypoints,
	assertEntrypointUnused,
	assertValidEntrypoint,
} from "../../modules/traefik";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Instance-level Traefik configuration: the extra TCP/UDP entrypoints a
 * `tcp`/`udp` domain can bind to.
 *
 * Every mutation here rewrites the proxy's **static** config and republishes
 * host ports, which recreates the `nixploy-traefik` task — a short outage for
 * every route on the instance (~9 s measured). Host ports are also one shared
 * namespace across tenants. Both reasons make this instance-admin only; the
 * panel warns before saving.
 */

type Session = NonNullable<TRPCContext["session"]>;

/** Platform-wide infrastructure: instance admin, with an org for the audit row. */
async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const entrypointInput = z.object({
	name: z.string().min(2).max(32),
	port: z.number().int().min(1).max(65535),
	protocol: z.enum(["tcp", "udp"]),
});

export const traefikRouter = router({
	/**
	 * Every configured layer-4 entrypoint. Readable by any member so the
	 * domain form can offer them; creating one still needs the instance admin.
	 */
	listEntrypoints: protectedProcedure.query(async () => {
		return db.query.traefikEntrypoints.findMany({
			orderBy: [traefikEntrypoints.port],
		});
	}),

	/**
	 * Declare a new entrypoint and make Traefik serve it. Restarts the proxy:
	 * static configuration is only read at start.
	 */
	createEntrypoint: protectedProcedure.input(entrypointInput).mutation(async ({ ctx, input }) => {
		const organizationId = await requireInstanceAdmin(ctx.session);
		const spec = assertValidEntrypoint(input);

		let created: typeof traefikEntrypoints.$inferSelect | undefined;
		try {
			[created] = await db.insert(traefikEntrypoints).values(spec).returning();
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw conflict(
					`An entrypoint with this name or ${spec.protocol} port ${spec.port} already exists`,
				);
			}
			throw error;
		}
		if (!created) throw new Error("Failed to create entrypoint");

		let restarted = false;
		try {
			restarted = (await applyTraefikEntrypoints()).restarted;
		} catch (error) {
			// Compensation: a row Traefik never learned about would let a
			// domain bind to an entrypoint that does not exist.
			await db
				.delete(traefikEntrypoints)
				.where(eq(traefikEntrypoints.traefikEntrypointId, created.traefikEntrypointId))
				.catch(() => {});
			throw error;
		}

		await auditFromSession(ctx, organizationId, {
			action: "traefik.entrypoint.create",
			targetType: "traefikEntrypoint",
			targetId: created.traefikEntrypointId,
			targetName: created.name,
			metadata: { port: created.port, protocol: created.protocol },
		});
		return { entrypoint: created, restarted };
	}),

	/**
	 * Remove an entrypoint, unpublish its port and restart the proxy. Refused
	 * while a domain still routes through it.
	 */
	deleteEntrypoint: protectedProcedure
		.input(z.object({ traefikEntrypointId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			const existing = await db.query.traefikEntrypoints.findFirst({
				where: eq(traefikEntrypoints.traefikEntrypointId, input.traefikEntrypointId),
			});
			if (!existing) throw notFound("Entrypoint not found");
			await assertEntrypointUnused(existing.name);

			await db
				.delete(traefikEntrypoints)
				.where(eq(traefikEntrypoints.traefikEntrypointId, input.traefikEntrypointId));
			try {
				await applyTraefikEntrypoints();
			} catch (error) {
				await db
					.insert(traefikEntrypoints)
					.values(existing)
					.catch(() => {});
				throw error;
			}

			await auditFromSession(ctx, organizationId, {
				action: "traefik.entrypoint.delete",
				targetType: "traefikEntrypoint",
				targetId: existing.traefikEntrypointId,
				targetName: existing.name,
			});
			return { traefikEntrypointId: input.traefikEntrypointId };
		}),
});
