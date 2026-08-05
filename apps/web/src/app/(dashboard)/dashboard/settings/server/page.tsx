import type { Metadata } from "next";

import { ServerSettingsView } from "@/components/settings/server/server-settings-view";

export const metadata: Metadata = {
	title: "Server Settings",
};

export default function ServerSettingsPage() {
	return <ServerSettingsView />;
}
