import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applications, security } from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	getServiceContext,
	syncApplicationTraefik,
} from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { resyncComposeDomains } from "../../modules/compose/service";
import { assertCapability } from "../../modules/projects";
import { bestEffort } from "../../utils/best-effort";
import { assertBasicAuthUsername, assertComposeServiceName } from "../../utils/validators";
import { protectedProcedure, router } from "../init";

const BCRYPT_ROUNDS = 10;

/** Strip the password hash from a security row before returning it to clients. */
const redact = <T extends { password: string }>(row: T): Omit<T, "password"> => {
	const { password: _password, ...rest } = row;
	return rest;
};

/** Verify a compose service belongs to the org (returns its context). */
const assertComposeAccess = async (composeId: string, organizationId: string) => {
	const context = await getServiceContext("compose", composeId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	}
	return context;
};

type SecurityRow = typeof security.$inferSelect;

/** Rewrite the Traefik config of whichever service owns the row. */
const resyncParent = async (entry: SecurityRow): Promise<void> => {
	if (entry.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, entry.applicationId),
		});
		if (application) await syncApplicationTraefik(application);
		return;
	}
	if (entry.composeId) {
		await resyncComposeDomains(entry.composeId);
	}
};

/** Load a security row and verify org ownership through its parent service. */
const findSecurity = async (securityId: string, organizationId: string) => {
	const entry = await db.query.security.findFirst({
		where: eq(security.securityId, securityId),
	});
	if (!entry) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Security entry not found",
		});
	}
	if (entry.applicationId) {
		await assertApplicationAccess(entry.applicationId, organizationId);
	} else if (entry.composeId) {
		await assertComposeAccess(entry.composeId, organizationId);
	} else {
		throw new TRPCError({ code: "NOT_FOUND", message: "Security entry not found" });
	}
	return entry;
};

export const securityRouter = router({
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			const entries = await db.query.security.findMany({
				where: eq(security.applicationId, input.applicationId),
				orderBy: security.createdAt,
			});
			return entries.map(redact);
		}),

	/** Basic-auth entries of a compose stack, optionally narrowed to a service. */
	byCompose: protectedProcedure
		.input(
			z.object({
				composeId: z.string().min(1),
				serviceName: z.string().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertComposeAccess(input.composeId, organizationId);
			const entries = await db.query.security.findMany({
				where: input.serviceName
					? and(
							eq(security.composeId, input.composeId),
							eq(security.serviceName, input.serviceName),
						)
					: eq(security.composeId, input.composeId),
				orderBy: security.createdAt,
			});
			return entries.map(redact);
		}),

	one: protectedProcedure
		.input(z.object({ securityId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			return redact(await findSecurity(input.securityId, organizationId));
		}),

	create: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
					/** Required with composeId: which compose service to protect. */
					serviceName: z.string().min(1).optional(),
					username: z.string().min(1),
					password: z.string().min(1),
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Exactly one of applicationId or composeId is required",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			if (input.applicationId) {
				await assertApplicationAccess(input.applicationId, organizationId);
			} else if (input.composeId) {
				await assertComposeAccess(input.composeId, organizationId);
				if (!input.serviceName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "serviceName is required for compose basic auth",
					});
				}
				assertComposeServiceName(input.serviceName);
			}
			assertBasicAuthUsername(input.username);

			// Traefik's basicAuth middleware expects bcrypt-hashed passwords.
			const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
			const [entry] = await db
				.insert(security)
				.values({
					username: input.username,
					password: hashed,
					applicationId: input.applicationId ?? null,
					composeId: input.composeId ?? null,
					serviceName: input.composeId ? (input.serviceName ?? null) : null,
				})
				.returning();
			if (!entry) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create security entry",
				});
			}

			try {
				await resyncParent(entry);
			} catch (error) {
				// Compensation: without it the client sees a 500 but the row exists,
				// and a retry can stack duplicate basic-auth entries behind the failure.
				await bestEffort("roll back basic-auth entry", () =>
					db.delete(security).where(eq(security.securityId, entry.securityId)),
				);
				throw error;
			}
			await auditFromSession(ctx, organizationId, {
				action: "security.create",
				targetType: "security",
				targetId: entry.securityId,
				targetName: entry.username,
			});
			return redact(entry);
		}),

	update: protectedProcedure
		.input(
			z.object({
				securityId: z.string().min(1),
				username: z.string().min(1).optional(),
				/** Omit to keep the current password. */
				password: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const entry = await findSecurity(input.securityId, organizationId);
			if (input.password) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			if (input.username) {
				assertBasicAuthUsername(input.username);
			}

			const [updated] = await db
				.update(security)
				.set({
					username: input.username ?? entry.username,
					...(input.password ? { password: await bcrypt.hash(input.password, BCRYPT_ROUNDS) } : {}),
				})
				.where(eq(security.securityId, entry.securityId))
				.returning();

			try {
				await resyncParent(updated ?? entry);
			} catch (error) {
				// Compensation: restore the previous row so the client can retry
				// instead of finding a half-applied update behind the 500.
				await bestEffort("restore basic-auth entry", () =>
					db
						.update(security)
						.set({
							username: entry.username,
							password: entry.password,
						})
						.where(eq(security.securityId, entry.securityId)),
				);
				throw error;
			}
			await auditFromSession(ctx, organizationId, {
				action: "security.update",
				targetType: "security",
				targetId: entry.securityId,
				targetName: input.username ?? entry.username,
			});
			return updated ? redact(updated) : updated;
		}),

	delete: protectedProcedure
		.input(z.object({ securityId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const entry = await findSecurity(input.securityId, organizationId);

			await db.delete(security).where(eq(security.securityId, entry.securityId));
			await resyncParent(entry);
			await auditFromSession(ctx, organizationId, {
				action: "security.delete",
				targetType: "security",
				targetId: entry.securityId,
				targetName: entry.username,
			});
			return { securityId: entry.securityId };
		}),
});
