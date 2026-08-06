import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createRegistry,
	findRegistryById,
	findServerById,
	listRegistriesByOrganization,
	removeRegistry,
	testRegistry,
	updateRegistryById,
} from "../../modules/cluster";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const registryIdInput = z.object({ registryId: z.string().min(1) });

const createRegistryInput = z.object({
	registryName: z.string().min(1),
	username: z.string().min(1),
	password: z.string().min(1),
	registryUrl: z.string().optional(),
	registryType: z.enum(["cloud", "selfHosted"]).optional(),
	imagePrefix: z.string().nullish(),
});

/** Response shape: the registry password is write-only. */
const publicRegistry = <T extends { password: string }>(registry: T): Omit<T, "password"> => {
	const { password: _password, ...rest } = registry;
	return rest;
};

export const registryRouter = router({
	/** All registries of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listRegistriesByOrganization(organizationId);
		return rows.map(publicRegistry);
	}),

	/** A single registry by id. */
	one: protectedProcedure.input(registryIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findRegistryById(input.registryId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
		}
		return publicRegistry(row);
	}),

	/** Add registry credentials (password is encrypted at rest). */
	create: protectedProcedure.input(createRegistryInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const created = await createRegistry(input, organizationId);
		if (!created) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create registry",
			});
		}
		return publicRegistry(created);
	}),

	/** Update registry credentials. */
	update: protectedProcedure
		.input(createRegistryInput.partial().extend({ registryId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const { registryId, ...values } = input;
			const updated = await updateRegistryById(registryId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
			}
			return publicRegistry(updated);
		}),

	/** Remove a registry. */
	remove: protectedProcedure.input(registryIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const removed = await removeRegistry(input.registryId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
		}
		return publicRegistry(removed);
	}),

	/**
	 * Perform a real `docker login` with the stored credentials — against the
	 * local Docker daemon, or on a managed server when `serverId` is given.
	 */
	test: protectedProcedure
		.input(registryIdInput.extend({ serverId: z.string().nullish() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			if (input.serverId) {
				const server = await findServerById(input.serverId, organizationId);
				if (!server) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
				}
			}
			return await testRegistry({
				registryId: input.registryId,
				organizationId,
				serverId: input.serverId ?? null,
			});
		}),
});
