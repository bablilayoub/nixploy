import { needsSetup } from "@nixploy/server/modules/auth/setup";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
	title: "Setup",
};

export const dynamic = "force-dynamic";

export default async function SetupPage() {
	if (!(await needsSetup())) {
		redirect("/login");
	}
	// SetupForm reads `?token=` with useSearchParams.
	return (
		<Suspense>
			<SetupForm />
		</Suspense>
	);
}
