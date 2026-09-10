import type { Metadata } from "next";
import { Suspense } from "react";

import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = {
	title: "Two-factor authentication",
};

export default function TwoFactorPage() {
	return (
		<Suspense>
			<TwoFactorForm />
		</Suspense>
	);
}
