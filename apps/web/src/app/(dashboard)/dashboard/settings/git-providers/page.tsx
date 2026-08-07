import type { Metadata } from "next";
import { Suspense } from "react";

import { GitProvidersView } from "@/components/settings/git-providers/git-providers-view";

export const metadata: Metadata = {
	title: "Git Provider Settings",
};

export default function GitProvidersSettingsPage() {
	return (
		<Suspense>
			<GitProvidersView />
		</Suspense>
	);
}
