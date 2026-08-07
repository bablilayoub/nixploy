import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { security } from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	syncApplicationTraefik,
} from "../../modules/application";
import { assertCapability, assertOrgRole } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const BCRYPT_ROUNDS = 10;

/** Strip the password hash from a security row before returning it to clients. */
const redact = <T extends { password: string }>(row: T): Omit<T, "password"> => {
	const { password: _password, ...rest } = row;
	return rest;
};

/** Load an application-owned security row and verify org ownership. */
const findApplicationSecurity = async (securityId: string, organizationId: string) => {
	const entry = await db.query.security.findFirst({
		where: eq(security.securityId, securityId),
	});
	if (!entry) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Security entry not found" });
	}
	const application = await assertApplicationAccess(entry.applicationId, organizationId);
	return { entry, application };
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

	one: protectedProcedure
		.input(z.object({ securityId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { entry } = await findApplicationSecurity(input.securityId, organizationId);
			return redact(entry);
		}),

	create: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1),
				username: z.string().min(1),
				password: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const application = await assertApplicationAccess(input.applicationId, organizationId);

			// Traefik's basicAuth middleware expects bcrypt-hashed passwords.
			const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
			const [entry] = await db
				.insert(security)
				.values({
					username: input.username,
					password: hashed,
					applicationId: input.applicationId,
				})
				.returning();
			if (!entry) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create security entry",
				});
			}

			await syncApplicationTraefik(application);
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
			const { entry, application } = await findApplicationSecurity(
				input.securityId,
				organizationId,
			);

			const [updated] = await db
				.update(security)
				.set({
					username: input.username ?? entry.username,
					...(input.password ? { password: await bcrypt.hash(input.password, BCRYPT_ROUNDS) } : {}),
				})
				.where(eq(security.securityId, entry.securityId))
				.returning();

			await syncApplicationTraefik(application);
			return updated ? redact(updated) : updated;
		}),

	delete: protectedProcedure
		.input(z.object({ securityId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { entry, application } = await findApplicationSecurity(
				input.securityId,
				organizationId,
			);

			await db.delete(security).where(eq(security.securityId, entry.securityId));
			await syncApplicationTraefik(application);
			return { securityId: entry.securityId };
		}),
});
