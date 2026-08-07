import type { Metadata } from "next";

import { DestinationsView } from "@/components/settings/destinations/destinations-view";

export const metadata: Metadata = {
	title: "Backup storage",
};

export default function DestinationsSettingsPage() {
	return <DestinationsView />;
}
