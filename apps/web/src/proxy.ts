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

	return NextResponse.next();
}

export const config = {
	matcher: ["/dashboard/:path*", "/register", "/register/:path*"],
};
