import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applications, domains, redirects } from "../../db/schema";
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
import { assertComposeServiceName } from "../../utils/validators";
import { protectedProcedure, router } from "../init";

const REDIRECT_REGEX_MAX = 256;
const REDIRECT_REPLACEMENT_MAX = 512;

/**
 * `replacement` is written verbatim into a Traefik `redirectRegex`, so an
 * absolute URL there is an open redirect on the tenant's own domain
 * (security.md §2.6). Absolute replacements must therefore be `https://`, or
 * point at one of the service's own hosts; relative ones stay same-host by
 * construction.
 */
function assertSafeRedirectRule(regex: string, replacement: string, ownHosts: string[]): void {
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
		// `RegExp(...)` without `new` parses the pattern just the same; the
		// object is thrown away, only the SyntaxError matters here.
		RegExp(regex);
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect regex is not a valid regular expression",
		});
	}
	if (replacement.includes("://")) {
		if (!/^https?:\/\/[^\s]+$/i.test(replacement)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid redirect replacement URL",
			});
		}
		let host: string;
		try {
			// Traefik capture placeholders (`${1}`) are legal URL characters.
			host = new URL(replacement).hostname.toLowerCase();
		} catch {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid redirect replacement URL",
			});
		}
		const sameHost = ownHosts.includes(host);
		if (!replacement.toLowerCase().startsWith("https://") && !sameHost) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"An absolute redirect must use https:// (or point at one of this service's own domains)",
			});
		}
		return;
	}
	if (!replacement.startsWith("/")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect replacement must be a path or http(s) URL",
		});
	}
}

/** Hosts routed to a service — the "same host" set for the check above. */
const loadOwnHosts = async (parent: {
	applicationId?: string | null;
	composeId?: string | null;
}): Promise<string[]> => {
	const where = parent.applicationId
		? eq(domains.applicationId, parent.applicationId)
		: parent.composeId
			? eq(domains.composeId, parent.composeId)
			: null;
	if (!where) return [];
	const rows = await db.query.domains.findMany({ where, columns: { host: true } });
	return rows.map((row) => row.host.toLowerCase());
};

/** Verify a compose service belongs to the org (returns its context). */
const assertComposeAccess = async (composeId: string, organizationId: string) => {
	const context = await getServiceContext("compose", composeId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	}
	return context;
};

type RedirectRow = typeof redirects.$inferSelect;

/** Rewrite the Traefik config of whichever service owns the row. */
const resyncParent = async (redirect: RedirectRow): Promise<void> => {
	if (redirect.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, redirect.applicationId),
		});
		if (application) await syncApplicationTraefik(application);
		return;
	}
	if (redirect.composeId) {
		await resyncComposeDomains(redirect.composeId);
	}
};

/** Load a redirect row and verify org ownership through its parent service. */
const findRedirect = async (redirectId: string, organizationId: string) => {
	const redirect = await db.query.redirects.findFirst({
		where: eq(redirects.redirectId, redirectId),
	});
	if (!redirect) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Redirect not found" });
	}
	if (redirect.applicationId) {
		await assertApplicationAccess(redirect.applicationId, organizationId);
	} else if (redirect.composeId) {
		await assertComposeAccess(redirect.composeId, organizationId);
	} else {
		throw new TRPCError({ code: "NOT_FOUND", message: "Redirect not found" });
	}
	return redirect;
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

	/** Redirects of a compose stack, optionally narrowed to one of its services. */
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
			return db.query.redirects.findMany({
				where: input.serviceName
					? and(
							eq(redirects.composeId, input.composeId),
							eq(redirects.serviceName, input.serviceName),
						)
					: eq(redirects.composeId, input.composeId),
				orderBy: redirects.createdAt,
			});
		}),

	one: protectedProcedure
		.input(z.object({ redirectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			return findRedirect(input.redirectId, organizationId);
		}),

	create: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
					/** Required with composeId: which compose service to protect. */
					serviceName: z.string().min(1).optional(),
					regex: z.string().min(1),
					replacement: z.string().min(1),
					permanent: z.boolean().default(false),
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Exactly one of applicationId or composeId is required",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.applicationId) {
				await assertApplicationAccess(input.applicationId, organizationId);
			} else if (input.composeId) {
				await assertComposeAccess(input.composeId, organizationId);
				if (!input.serviceName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "serviceName is required for compose redirects",
					});
				}
				assertComposeServiceName(input.serviceName);
			}
			assertSafeRedirectRule(
				input.regex,
				input.replacement,
				await loadOwnHosts({ applicationId: input.applicationId, composeId: input.composeId }),
			);

			const [redirect] = await db
				.insert(redirects)
				.values({
					regex: input.regex,
					replacement: input.replacement,
					permanent: input.permanent,
					applicationId: input.applicationId ?? null,
					composeId: input.composeId ?? null,
					serviceName: input.composeId ? (input.serviceName ?? null) : null,
				})
				.returning();
			if (!redirect) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create redirect",
				});
			}

			try {
				await resyncParent(redirect);
			} catch (error) {
				// Compensation: without it the client sees a 500 but the row exists,
				// and a retry can stack duplicate redirects behind the failure.
				await bestEffort("roll back redirect row", () =>
					db.delete(redirects).where(eq(redirects.redirectId, redirect.redirectId)),
				);
				throw error;
			}
			await auditFromSession(ctx, organizationId, {
				action: "redirect.create",
				targetType: "redirect",
				targetId: redirect.redirectId,
				targetName: redirect.regex,
			});
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
			const redirect = await findRedirect(input.redirectId, organizationId);
			const regex = input.regex ?? redirect.regex;
			const replacement = input.replacement ?? redirect.replacement;
			assertSafeRedirectRule(regex, replacement, await loadOwnHosts(redirect));

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
				await resyncParent(updated ?? redirect);
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
			await auditFromSession(ctx, organizationId, {
				action: "redirect.update",
				targetType: "redirect",
				targetId: redirect.redirectId,
				targetName: regex,
			});
			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ redirectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const redirect = await findRedirect(input.redirectId, organizationId);

			await db.delete(redirects).where(eq(redirects.redirectId, redirect.redirectId));
			await resyncParent(redirect);
			await auditFromSession(ctx, organizationId, {
				action: "redirect.delete",
				targetType: "redirect",
				targetId: redirect.redirectId,
				targetName: redirect.regex,
			});
			return { redirectId: redirect.redirectId };
		}),
});
