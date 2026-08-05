import type { Metadata } from "next";

import { DestinationsView } from "@/components/settings/destinations/destinations-view";

export const metadata: Metadata = {
	title: "Destination Settings",
};

export default function DestinationsSettingsPage() {
	return <DestinationsView />;
}
