import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeGithubAppState, setupGithubApp } from "@nixploy/server/modules/git/github";
import {
	assertCapability,
	resolveCallerOrganizationId,
} from "@nixploy/server/modules/projects/index";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETUP_COOKIE = "nixploy_github_app_setup";
const SETUP_MAX_AGE_SEC = 600;

function setupCookieSecret(): string {
	const key = process.env.BETTER_AUTH_SECRET;
	if (!key) {
		throw new Error("BETTER_AUTH_SECRET is required to sign the GitHub App setup cookie");
	}
	return key;
}

/** HMAC-sign the stashed code/state so a forged cookie cannot inject them. */
function signSetupStash(payload: string): string {
	const sig = createHmac("sha256", setupCookieSecret()).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

/** Returns the payload when the signature matches, null otherwise. */
function verifySetupStash(value: string): string | null {
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	const expected = createHmac("sha256", setupCookieSecret()).update(payload).digest("base64url");
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	return payload;
}

function appOrigin(request: Request): string {
	const configured =
		process.env.BETTER_AUTH_URL?.trim() ||
		process.env.NIXPLOY_BASE_URL?.trim() ||
		process.env.NEXT_PUBLIC_APP_URL?.trim();
	if (configured) {
		try {
			return new URL(configured).origin;
		} catch {
			// fall through
		}
	}
	return new URL(request.url).origin;
}

/**
 * GitHub App manifest callback. GitHub redirects here with `code` (+ `state`
 * when we submitted it as a form field). We exchange the code for App
 * credentials and send the user back to Settings → Git providers.
 *
 * Unauthenticated visits stash `code`/`state` in an httpOnly cookie (never on
 * the login URL) and resume after sign-in.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const origin = appOrigin(request);
	const codeParam = url.searchParams.get("code");
	const stateParam = url.searchParams.get("state");
	const settingsUrl = new URL("/dashboard/settings/git-providers", origin);

	const session = await getSession();
	const cookieHeader = request.headers.get("cookie") ?? "";
	const cookieMatch = cookieHeader
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${SETUP_COOKIE}=`));
	let stashed: { code: string; state: string } | null = null;
	if (cookieMatch) {
		try {
			const raw = decodeURIComponent(cookieMatch.slice(SETUP_COOKIE.length + 1));
			const payload = verifySetupStash(raw);
			stashed = payload ? (JSON.parse(payload) as { code: string; state: string }) : null;
		} catch {
			stashed = null;
		}
	}

	const code = codeParam ?? stashed?.code ?? null;
	const state = stateParam ?? stashed?.state ?? null;

	if (!session) {
		if (!code || !state) {
			settingsUrl.searchParams.set("githubError", code ? "missing_state" : "missing_code");
			return NextResponse.redirect(settingsUrl);
		}
		const login = new URL("/login", origin);
		login.searchParams.set("next", "/api/github/callback");
		const response = NextResponse.redirect(login);
		response.cookies.set(
			SETUP_COOKIE,
			encodeURIComponent(signSetupStash(JSON.stringify({ code, state }))),
			{
				httpOnly: true,
				secure: origin.startsWith("https:"),
				sameSite: "lax",
				maxAge: SETUP_MAX_AGE_SEC,
				path: "/",
			},
		);
		return response;
	}

	if (!code) {
		settingsUrl.searchParams.set("githubError", "missing_code");
		return NextResponse.redirect(settingsUrl);
	}
	if (!state) {
		settingsUrl.searchParams.set("githubError", "missing_state");
		return NextResponse.redirect(settingsUrl);
	}

	try {
		const decoded = decodeGithubAppState(state);
		if (!decoded.githubId) {
			throw new Error("GitHub App state is missing githubId");
		}
		const organizationId = await resolveCallerOrganizationId(
			session.user.id,
			session.session.activeOrganizationId,
		);
		await assertCapability(session.user.id, organizationId, "git_providers.manage");
		await setupGithubApp({
			githubId: decoded.githubId,
			organizationId,
			code,
			state,
		});
		settingsUrl.searchParams.set("github", "connected");
		const response = NextResponse.redirect(settingsUrl);
		response.cookies.set(SETUP_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : "GitHub App setup failed";
		settingsUrl.searchParams.set("githubError", message.slice(0, 200));
		const response = NextResponse.redirect(settingsUrl);
		response.cookies.set(SETUP_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
		return response;
	}
}
