import { decodeGithubAppState, setupGithubApp } from "@nixploy/server/modules/git/github";
import {
	assertCapability,
	resolveCallerOrganizationId,
} from "@nixploy/server/modules/projects/index";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GitHub App manifest callback. GitHub redirects here with `code` (+ `state`
 * when we submitted it as a form field). We exchange the code for App
 * credentials and send the user back to Settings → Git providers.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const stateParam = url.searchParams.get("state");
	const settingsUrl = new URL("/dashboard/settings/git-providers", url.origin);

	if (!code) {
		settingsUrl.searchParams.set("githubError", "missing_code");
		return NextResponse.redirect(settingsUrl);
	}
	if (!stateParam) {
		settingsUrl.searchParams.set("githubError", "missing_state");
		return NextResponse.redirect(settingsUrl);
	}

	const session = await getSession();
	if (!session) {
		const login = new URL("/login", url.origin);
		login.searchParams.set("callbackUrl", `${url.pathname}${url.search}`);
		return NextResponse.redirect(login);
	}

	try {
		const state = decodeGithubAppState(stateParam);
		if (!state.githubId) {
			throw new Error("GitHub App state is missing githubId");
		}
		const organizationId = await resolveCallerOrganizationId(
			session.user.id,
			session.session.activeOrganizationId,
		);
		await assertCapability(session.user.id, organizationId, "git_providers.manage");
		await setupGithubApp({
			githubId: state.githubId,
			organizationId,
			code,
			state: stateParam,
		});
		settingsUrl.searchParams.set("github", "connected");
		return NextResponse.redirect(settingsUrl);
	} catch (error) {
		const message = error instanceof Error ? error.message : "GitHub App setup failed";
		settingsUrl.searchParams.set("githubError", message.slice(0, 200));
		return NextResponse.redirect(settingsUrl);
	}
}
