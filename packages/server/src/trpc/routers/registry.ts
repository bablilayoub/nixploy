import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import {
	createRegistry,
	findRegistryById,
	findServerById,
	listRegistriesByOrganization,
	removeRegistry,
	testRegistry,
	updateRegistryById,
} from "../../modules/cluster";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Normalize registry host/URL and block metadata / private SSRF targets. */
async function assertSafeRegistryUrl(registryUrl: string, registryType?: "cloud" | "selfHosted") {
	const trimmed = registryUrl.trim();
	if (!trimmed) return;
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	const allowPrivate = registryType === "selfHosted";
	try {
		await assertSafeOutboundUrl(withScheme, {
			allowPrivate,
			allowHttp: allowPrivate,
		});
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: error instanceof Error ? `Registry URL: ${error.message}` : "Invalid registry URL",
		});
	}
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
		await assertCapability(ctx.session.user.id, organizationId, "registries.manage");
		if (input.registryUrl) {
			await assertSafeRegistryUrl(input.registryUrl, input.registryType);
		}
		const created = await createRegistry(input, organizationId);
		if (!created) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create registry",
			});
		}
		void auditFromSession(ctx, organizationId, {
			action: "registry.create",
			targetType: "registry",
			targetId: created.registryId,
			targetName: created.registryName,
			metadata: { registryUrl: created.registryUrl, registryType: created.registryType },
		});
		return publicRegistry(created);
	}),

	/** Update registry credentials. */
	update: protectedProcedure
		.input(createRegistryInput.partial().extend({ registryId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "registries.manage");
			const { registryId, ...values } = input;
			const existing = await findRegistryById(registryId, organizationId);
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
			}
			if (values.registryUrl) {
				await assertSafeRegistryUrl(
					values.registryUrl,
					values.registryType ?? existing.registryType ?? undefined,
				);
				// Changing the URL without re-entering the password would let a
				// `registries.manage` user point the stored credentials at an
				// attacker host and exfiltrate them via `test`.
				const urlChanged = values.registryUrl.trim() !== (existing.registryUrl ?? "").trim();
				if (urlChanged && !values.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Re-enter the registry password when changing the registry URL",
					});
				}
			}
			const updated = await updateRegistryById(registryId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "registry.update",
				targetType: "registry",
				targetId: registryId,
				targetName: updated.registryName,
				metadata: {
					credentialsChanged: values.password !== undefined || values.username !== undefined,
					urlChanged:
						values.registryUrl !== undefined &&
						values.registryUrl.trim() !== (existing.registryUrl ?? "").trim(),
				},
			});
			return publicRegistry(updated);
		}),

	/** Remove a registry. */
	remove: protectedProcedure.input(registryIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "registries.manage");
		const removed = await removeRegistry(input.registryId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
		}
		void auditFromSession(ctx, organizationId, {
			action: "registry.delete",
			targetType: "registry",
			targetId: removed.registryId,
			targetName: removed.registryName,
		});
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
			await assertCapability(ctx.session.user.id, organizationId, "registries.manage");
			const row = await findRegistryById(input.registryId, organizationId);
			if (!row) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
			}
			if (row.registryUrl) {
				await assertSafeRegistryUrl(row.registryUrl, row.registryType ?? undefined);
			}
			if (input.serverId) {
				const server = await findServerById(input.serverId, organizationId);
				if (!server) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
				}
			} else {
				await assertInstanceAdmin(ctx.session);
			}
			void auditFromSession(ctx, organizationId, {
				action: "registry.test",
				targetType: "registry",
				targetId: row.registryId,
				targetName: row.registryName,
				metadata: { serverId: input.serverId ?? null },
			});
			return await testRegistry({
				registryId: input.registryId,
				organizationId,
				serverId: input.serverId ?? null,
			});
		}),
});
