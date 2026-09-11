import { needsSetup } from "@nixploy/server/modules/auth/setup";
import { publicSsoInfo } from "@nixploy/server/modules/auth/sso";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "@/lib/auth-server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
	title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
	if (await needsSetup()) {
		redirect("/setup");
	}
	// Authoritative check (not the proxy's cookie-presence test): a stale
	// cookie must land on the form, not loop against the dashboard layout.
	if (await getSession()) {
		redirect("/dashboard");
	}
	// Resolved on the server and handed down as a prop: the client bundle must
	// stay free of NEXT_PUBLIC_* configuration (CLAUDE.md).
	const sso = publicSsoInfo();
	return (
		<Suspense>
			<LoginForm sso={sso} />
		</Suspense>
	);
}
