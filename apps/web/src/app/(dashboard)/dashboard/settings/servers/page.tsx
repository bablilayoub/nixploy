import type { Metadata } from "next";

import { ServersView } from "@/components/settings/servers/servers-view";

export const metadata: Metadata = {
	title: "Server Settings",
};

export default function ServersSettingsPage() {
	return <ServersView />;
}
