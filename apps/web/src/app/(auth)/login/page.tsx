import { needsSetup } from "@nixploy/server/modules/auth/setup";
import { publicSsoInfo } from "@nixploy/server/modules/auth/sso";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
	title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
	if (await needsSetup()) {
		redirect("/setup");
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
