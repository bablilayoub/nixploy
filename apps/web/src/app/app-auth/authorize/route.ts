import {
	DEFAULT_SESSION_HOURS,
	evaluateAppAuthPolicy,
	groupsOf,
	hostMatchesDomain,
	issueExchangeCode,
	loadProtectedDomain,
	resolveAppAuthIdentity,
	safeReturnPath,
} from "@nixploy/server/modules/app-auth/index";

import { getSession } from "@/lib/auth-server";
import { standalonePage } from "@/lib/standalone-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Second leg of forward auth, on the **panel's** origin.
 *
 * The verify endpoint sends a browser here when it has no session cookie for a
 * protected host. Here the panel session is authoritative — with the org's own
 * 2FA and SSO gates already applied by the sign-in it required — the policy is
 * evaluated, and a short-lived one-time code is handed back to the protected
 * host so the cookie can be set on that host rather than on this one.
 *
 * The host is never trusted from the query string alone: it is matched against
 * the domain row named by `d` before anything redirects to it. Without that
 * check this endpoint would be an open redirect wearing a session.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const domainId = url.searchParams.get("d");
	const host = (url.searchParams.get("h") ?? "").toLowerCase();
	const proto = url.searchParams.get("p") === "http" ? "http" : "https";
	const next = safeReturnPath(url.searchParams.get("r"));

	if (!domainId || !host)
		return standalonePage(400, "Bad request", "This sign-in link is incomplete.");

	const policy = await loadProtectedDomain(domainId).catch(() => null);
	if (!policy || !hostMatchesDomain(policy.host, host)) {
		return standalonePage(404, "Not found", "This app is not protected by Nixploy sign-in.");
	}

	const session = await getSession();
	if (!session) {
		const back = new URL(url.pathname + url.search, url.origin);
		return Response.redirect(
			new URL(
				`/login?redirect=${encodeURIComponent(back.pathname + back.search)}`,
				url.origin,
			).toString(),
			302,
		);
	}

	const identity = await resolveAppAuthIdentity(
		session.user,
		policy.organizationId,
		policy.projectId,
	);
	const decision = evaluateAppAuthPolicy(policy.config, identity);
	if (!decision.allowed) {
		// A refusal is a dead end on purpose: bouncing back to the app would
		// send the browser round the loop again and end in a redirect error
		// instead of a sentence the person can act on.
		return standalonePage(403, "No access to this app", `${decision.reason} (${host})`);
	}

	const hours = policy.config.sessionHours ?? DEFAULT_SESSION_HOURS;
	const code = issueExchangeCode({
		u: identity.userId,
		e: identity.email,
		n: identity.name,
		g: groupsOf(identity),
		h: host,
		r: next,
		t: hours * 3600,
	});

	const callback = new URL("/_nixploy/callback", `${proto}://${host}`);
	callback.searchParams.set("code", code);
	return Response.redirect(callback.toString(), 302);
}
