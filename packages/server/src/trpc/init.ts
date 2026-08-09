import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { db } from "../db";
import { auth } from "../lib/auth";
import { getOrganizationId } from "../modules/application/org";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "../modules/auth/two-factor-gate";

export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({ headers: opts.headers });
	// Sessions created before the session-create hook existed (or via flows
	// that skip it) carry no activeOrganizationId. Backfill it from the
	// user's first membership so org-scoped routers work for them too.
	if (session && !session.session.activeOrganizationId) {
		const membership = await db.query.members.findFirst({
			where: (m, { eq }) => eq(m.userId, session.user.id),
			orderBy: (m, { asc }) => asc(m.createdAt),
		});
		session.session.activeOrganizationId = membership?.organizationId ?? null;
	}
	return {
		headers: opts.headers,
		session,
	};
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
	transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	const session = ctx.session;
	// Lazily memoized via getOrganizationId's per-session WeakMap — one
	// membership lookup shared across every procedure in this HTTP request.
	const organizationId = () => getOrganizationId(session);

	// Org-level 2FA enforcement: members without 2FA on their account are
	// blocked from every org-scoped procedure until they enable it. Users
	// with no organization (first-run setup) are exempt — org resolution
	// fails FORBIDDEN for them and org-scoped procedures reject on their own.
	let twoFactorGated = false;
	try {
		const orgId = await organizationId();
		twoFactorGated = await isTwoFactorGateBlocked(session.user.id, orgId);
	} catch {
		// No organization (FORBIDDEN) or an unreachable database: org-scoped
		// procedures reject or fail on their own queries — the gate must not
		// take down procedures that never touch tenant data.
	}
	if (twoFactorGated) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: TWO_FACTOR_REQUIRED_MESSAGE,
		});
	}

	return next({
		ctx: {
			...ctx,
			session,
			organizationId,
		},
	});
});
