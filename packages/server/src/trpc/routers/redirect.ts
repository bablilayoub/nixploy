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
import { assertCapability } from "../../modules/projects";
import { bestEffort } from "../../utils/best-effort";
import { protectedProcedure, router } from "../init";

const REDIRECT_REGEX_MAX = 256;
const REDIRECT_REPLACEMENT_MAX = 512;

function assertSafeRedirectRule(regex: string, replacement: string): void {
	if (regex.length > REDIRECT_REGEX_MAX || replacement.length > REDIRECT_REPLACEMENT_MAX) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect pattern is too long",
		});
	}
	if (/[()]/.test(regex) || /\\[0-9]/.test(regex)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect regex must not use capturing groups or backreferences",
		});
	}
	if (!/^[\w\-./*?^$|[\]{}+\\: =@%&]+$/.test(regex)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect regex contains invalid characters",
		});
	}
	// The whitelist admits syntactically broken patterns (`[`, `a{2,1}`).
	// Traefik then fails to build the middleware and, since it is attached
	// to every router of the app, the whole app 404s. JS and RE2 agree on
	// the allowed character set closely enough to catch these up front.
	try {
		new RegExp(regex);
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect regex is not a valid regular expression",
		});
	}
	if (replacement.includes("://") && !/^https?:\/\/[^\s]+$/i.test(replacement)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid redirect replacement URL",
		});
	}
	if (!replacement.includes("://") && !replacement.startsWith("/")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect replacement must be a path or http(s) URL",
		});
	}
}

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
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			assertSafeRedirectRule(input.regex, input.replacement);

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

			try {
				await syncApplicationTraefik(application);
			} catch (error) {
				// Compensation: without it the client sees a 500 but the row exists,
				// and a retry can stack duplicate redirects behind the failure.
				await bestEffort("roll back redirect row", () =>
					db.delete(redirects).where(eq(redirects.redirectId, redirect.redirectId)),
				);
				throw error;
			}
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
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { redirect, application } = await findApplicationRedirect(
				input.redirectId,
				organizationId,
			);
			const regex = input.regex ?? redirect.regex;
			const replacement = input.replacement ?? redirect.replacement;
			assertSafeRedirectRule(regex, replacement);

			const next = {
				regex,
				replacement,
				permanent: input.permanent ?? redirect.permanent,
			};
			const [updated] = await db
				.update(redirects)
				.set(next)
				.where(eq(redirects.redirectId, redirect.redirectId))
				.returning();

			try {
				await syncApplicationTraefik(application);
			} catch (error) {
				// Compensation: restore the previous row so the client can retry
				// instead of finding a half-applied update behind the 500.
				await bestEffort("restore redirect row", () =>
					db
						.update(redirects)
						.set({
							regex: redirect.regex,
							replacement: redirect.replacement,
							permanent: redirect.permanent,
						})
						.where(eq(redirects.redirectId, redirect.redirectId)),
				);
				throw error;
			}
			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ redirectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const { redirect, application } = await findApplicationRedirect(
				input.redirectId,
				organizationId,
			);

			await db.delete(redirects).where(eq(redirects.redirectId, redirect.redirectId));
			await syncApplicationTraefik(application);
			return { redirectId: redirect.redirectId };
		}),
});
