import { type NextRequest, NextResponse } from "next/server";

/**
 * Edge gate for the dashboard. This only checks for the *presence* of the
 * better-auth session cookie (named `better-auth.session_token`, prefixed
 * with `__Secure-` when served over HTTPS) — the authoritative validation
 * happens in the (dashboard) layout via `auth.api.getSession`.
 *
 * First-boot routing (/setup vs /login) is handled in those pages via a
 * server-side user-count check — edge middleware cannot query Postgres.
 */
function hasSessionCookie(req: NextRequest): boolean {
	return req.cookies.getAll().some((cookie) => cookie.name.endsWith("better-auth.session_token"));
}

export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	const authenticated = hasSessionCookie(req);

	if (pathname.startsWith("/dashboard") && !authenticated) {
		return NextResponse.redirect(new URL("/login", req.url));
	}

	// Legacy public register — permanently gone.
	if (pathname === "/register" || pathname.startsWith("/register/")) {
		return NextResponse.redirect(new URL("/setup", req.url));
	}

	if ((pathname === "/login" || pathname === "/setup") && authenticated) {
		return NextResponse.redirect(new URL("/dashboard", req.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/dashboard/:path*", "/login", "/setup", "/register", "/register/:path*"],
};
