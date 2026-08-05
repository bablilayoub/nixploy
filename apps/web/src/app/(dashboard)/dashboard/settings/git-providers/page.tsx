import type { Metadata } from "next";

import { GitProvidersView } from "@/components/settings/git-providers/git-providers-view";

export const metadata: Metadata = {
	title: "Git Provider Settings",
};

export default function GitProvidersSettingsPage() {
	return <GitProvidersView />;
}
