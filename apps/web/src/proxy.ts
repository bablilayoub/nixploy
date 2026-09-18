import { type NextRequest, NextResponse } from "next/server";

/**
 * Request gate for the dashboard (Next.js `proxy.ts`, formerly `middleware.ts`;
 * runs in the Node.js runtime). This only checks for the *presence* of the
 * better-auth session cookie (named `better-auth.session_token`, prefixed
 * with `__Secure-` when served over HTTPS) — the authoritative validation
 * happens in the (dashboard) layout via `auth.api.getSession`.
 *
 * The auth pages are deliberately NOT bounced here on cookie presence: a
 * stale cookie (another panel on the same host — cookies ignore the port —
 * or an expired session) would send /login → /dashboard while the layout's
 * real check sends /dashboard → /login, an infinite redirect loop. /login and
 * /setup verify the session themselves and redirect signed-in users.
 *
 * First-boot routing (/setup vs /login) is handled in those pages via a
 * server-side user-count check — the proxy stays free of database access so
 * it never blocks on a cold pool.
 */
function hasSessionCookie(req: NextRequest): boolean {
	return req.cookies.getAll().some((cookie) => cookie.name.endsWith("better-auth.session_token"));
}

export function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;
	const authenticated = hasSessionCookie(req);

	if (pathname.startsWith("/dashboard") && !authenticated) {
		return NextResponse.redirect(new URL("/login", req.url));
	}

	// Legacy public register — permanently gone.
	if (pathname === "/register" || pathname.startsWith("/register/")) {
		return NextResponse.redirect(new URL("/setup", req.url));
	}

	/*
	 * Operator-uploaded branding assets get a sandbox on top of the global
	 * `frame-ancestors` policy: an SVG is a document that can carry script, and
	 * this one is served from the panel's own origin. `modules/branding` strips
	 * the obvious weapons on upload; this covers what a denylist misses if the
	 * file is ever opened as a top-level document rather than through an `img`.
	 *
	 * Here rather than in `next.config.ts` or on the route's own Response,
	 * because neither of those survives: a per-path `headers()` entry never
	 * matched this route (verified — a marker header did not appear either),
	 * and a header set in a handler is replaced by the global config's.
	 */
	if (pathname.startsWith("/api/branding/")) {
		const response = NextResponse.next();
		response.headers.set(
			"Content-Security-Policy",
			"sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
		);
		return response;
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/dashboard/:path*", "/register", "/register/:path*", "/api/branding/:path*"],
};
