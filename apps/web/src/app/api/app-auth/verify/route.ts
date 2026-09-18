import {
	APP_AUTH_COOKIE,
	AUTH_RESPONSE_HEADERS,
	hostMatchesDomain,
	isBypassPath,
	loadProtectedDomain,
	panelPublicOrigin,
	readSessionCookie,
} from "@nixploy/server/modules/app-auth/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Traefik's `forwardAuth` endpoint for panel-protected domains.
 *
 * Called on every request to a protected host, from inside the overlay
 * network (`http://nixploy:3000/api/app-auth/verify?domain=<id>`), with the
 * original request's headers — including its cookies. A 2xx lets the request
 * through and any header named in `authResponseHeaders` is copied onto it; any
 * other status is returned to the client verbatim, which is how the 302 to the
 * panel's sign-in becomes the browser's redirect.
 *
 * **Fails closed.** A missing domain id, an unreadable policy or a host that
 * does not match the policy's own row all answer 403 rather than passing the
 * request on: the middleware only exists on domains somebody asked to protect,
 * so "I cannot tell" must not mean "go ahead".
 *
 * The endpoint is reachable on the panel's public origin too. That is
 * harmless — it reads headers and a cookie and answers; it sets nothing and
 * grants nothing to its own caller — but it is why no decision here may depend
 * on a header being trustworthy for anything except the question being asked.
 */
export async function GET(req: Request) {
	return verify(req);
}
export async function POST(req: Request) {
	return verify(req);
}

const DENY = (reason: string) =>
	new Response(reason, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });

/** A browser navigation can be redirected; an XHR or a form POST cannot. */
const wantsRedirect = (req: Request): boolean => {
	const method = (req.headers.get("x-forwarded-method") ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return false;
	const accept = req.headers.get("accept") ?? "";
	if (!accept.includes("text/html") && accept !== "*/*") return false;
	// `Sec-Fetch-Mode: navigate` is the honest signal where it exists; where it
	// does not, the Accept check above is the fallback.
	const mode = req.headers.get("sec-fetch-mode");
	return mode === null || mode === "navigate";
};

/** Read one cookie out of the forwarded `Cookie` header. */
const cookieValue = (header: string | null, name: string): string | null => {
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
};

async function verify(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const domainId = url.searchParams.get("domain");
	if (!domainId) return DENY("This domain is protected but its policy is missing.");

	const policy = await loadProtectedDomain(domainId).catch(() => null);
	if (!policy) return DENY("This domain is protected but its policy could not be read.");

	const forwardedHost = (req.headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim() ?? "";
	if (!hostMatchesDomain(policy.host, forwardedHost)) {
		return DENY("This domain is protected but the request did not match its policy.");
	}
	const host = forwardedHost.split(":")[0]?.toLowerCase() ?? "";
	const uri = req.headers.get("x-forwarded-uri");

	// Health checks and webhooks never carry a browser session, so a protected
	// app would go down the moment it was protected without this.
	if (isBypassPath(uri, policy.config.bypassPaths)) {
		return new Response(null, { status: 204 });
	}

	const session = readSessionCookie(cookieValue(req.headers.get("cookie"), APP_AUTH_COOKIE), host);
	if (session) {
		const headers = new Headers();
		if (policy.config.injectHeaders) {
			const [user, email, groups] = AUTH_RESPONSE_HEADERS;
			headers.set(user, session.u);
			headers.set(email, session.e);
			headers.set(groups, session.g.join(","));
		}
		return new Response(null, { status: 204, headers });
	}

	if (!wantsRedirect(req)) {
		return new Response("Sign in to Nixploy to reach this app.", {
			status: 401,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}

	const origin = await panelPublicOrigin();
	if (!origin) {
		return DENY("This domain is protected but the panel has no public address to sign in on.");
	}
	const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim();
	const authorize = new URL("/app-auth/authorize", origin);
	authorize.searchParams.set("d", domainId);
	authorize.searchParams.set("h", host);
	authorize.searchParams.set("p", proto === "http" ? "http" : "https");
	if (uri) authorize.searchParams.set("r", uri);
	return Response.redirect(authorize.toString(), 302);
}
