import type { Metadata } from "next";

import { ServerSettingsView } from "@/components/settings/server/server-settings-view";

export const metadata: Metadata = {
	title: "Platform",
};

export default function ServerSettingsPage() {
	return <ServerSettingsView />;
}
