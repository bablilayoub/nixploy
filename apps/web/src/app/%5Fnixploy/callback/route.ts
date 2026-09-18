import {
	APP_AUTH_COOKIE,
	consumeExchangeCode,
	issueSessionCookie,
	safeReturnPath,
} from "@nixploy/server/modules/app-auth/index";

import { standalonePage } from "@/lib/standalone-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Final leg of forward auth, served on the **protected app's** host.
 *
 * Traefik routes `Host(<app>) && PathPrefix(/_nixploy/)` to the panel without
 * the forwardAuth middleware, so this runs with the tenant's hostname in
 * `Host` — which is the entire point: the session cookie it sets is host-only,
 * so one protected app's cookie is never sent to another, and the panel's own
 * session cookie is never exposed to a tenant's domain.
 *
 * The directory is `%5Fnixploy` because Next treats a leading underscore as a
 * private folder and would not route it; `%5F` is the documented escape and
 * the public path is still `/_nixploy/callback`.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const host = (req.headers.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
	const code = consumeExchangeCode(url.searchParams.get("code"), host);
	if (!code) {
		// Expired, replayed, or minted for another host. Nothing to do but send
		// them back through the front door.
		return standalonePage(
			400,
			"Sign-in link expired",
			"Reload the page you were trying to reach and sign in again.",
		);
	}

	const secure = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() !== "http";
	const cookie = issueSessionCookie(
		{ u: code.u, e: code.e, n: code.n, g: code.g, h: host },
		code.t,
	);

	const headers = new Headers();
	headers.set("location", safeReturnPath(code.r));
	headers.append(
		"set-cookie",
		[
			`${APP_AUTH_COOKIE}=${cookie}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Lax",
			`Max-Age=${code.t}`,
			...(secure ? ["Secure"] : []),
		].join("; "),
	);
	// No Domain attribute: host-only is what keeps one protected app's session
	// out of its siblings under the same parent domain.
	return new Response(null, { status: 302, headers });
}
