import type { Metadata } from "next";

import { TemplateSourcesView } from "@/components/settings/templates/template-sources-view";

export const metadata: Metadata = {
	title: "Template Settings",
};

export default function TemplateSettingsPage() {
	return <TemplateSourcesView />;
}
