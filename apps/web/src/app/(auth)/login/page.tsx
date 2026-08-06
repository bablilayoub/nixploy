import { needsSetup } from "@nixploy/server/modules/auth/setup";
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
	return (
		<Suspense>
			<LoginForm />
		</Suspense>
	);
}
