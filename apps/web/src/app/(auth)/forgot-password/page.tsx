import { needsSetup } from "@nixploy/server/modules/auth/setup";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
	title: "Forgot password",
};

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
	if (await needsSetup()) {
		redirect("/setup");
	}
	return <ForgotPasswordForm />;
}
