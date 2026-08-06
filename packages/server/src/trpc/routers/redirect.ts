import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { redirects } from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	syncApplicationTraefik,
} from "../../modules/application";
import { assertOrgRole } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Load an application-owned redirect row and verify org ownership. */
const findApplicationRedirect = async (redirectId: string, organizationId: string) => {
	const redirect = await db.query.redirects.findFirst({
		where: eq(redirects.redirectId, redirectId),
	});
	if (!redirect) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Redirect not found" });
	}
	const application = await assertApplicationAccess(redirect.applicationId, organizationId);
	return { redirect, application };
};

export const redirectRouter = router({
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			return db.query.redirects.findMany({
				where: eq(redirects.applicationId, input.applicationId),
				orderBy: redirects.createdAt,
			});
		}),

	one: protectedProcedure
		.input(z.object({ redirectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { redirect } = await findApplicationRedirect(input.redirectId, organizationId);
			return redirect;
		}),

	create: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1),
				regex: z.string().min(1),
				replacement: z.string().min(1),
				permanent: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const application = await assertApplicationAccess(input.applicationId, organizationId);

			const [redirect] = await db
				.insert(redirects)
				.values({
					regex: input.regex,
					replacement: input.replacement,
					permanent: input.permanent,
					applicationId: input.applicationId,
				})
				.returning();
			if (!redirect) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create redirect",
				});
			}

			await syncApplicationTraefik(application);
			return redirect;
		}),

	update: protectedProcedure
		.input(
			z.object({
				redirectId: z.string().min(1),
				regex: z.string().min(1).optional(),
				replacement: z.string().min(1).optional(),
				permanent: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const { redirect, application } = await findApplicationRedirect(
				input.redirectId,
				organizationId,
			);

			const [updated] = await db
				.update(redirects)
				.set({
					regex: input.regex ?? redirect.regex,
					replacement: input.replacement ?? redirect.replacement,
					permanent: input.permanent ?? redirect.permanent,
				})
				.where(eq(redirects.redirectId, redirect.redirectId))
				.returning();

			await syncApplicationTraefik(application);
			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ redirectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const { redirect, application } = await findApplicationRedirect(
				input.redirectId,
				organizationId,
			);

			await db.delete(redirects).where(eq(redirects.redirectId, redirect.redirectId));
			await syncApplicationTraefik(application);
			return { redirectId: redirect.redirectId };
		}),
});
