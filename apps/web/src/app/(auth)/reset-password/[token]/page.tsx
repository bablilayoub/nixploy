import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
	title: "Reset password",
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;
	return <ResetPasswordForm token={token} />;
}
