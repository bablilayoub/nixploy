import type { Metadata } from "next";

import { RegistriesView } from "@/components/settings/registries/registries-view";

export const metadata: Metadata = {
	title: "Registry Settings",
};

export default function RegistriesSettingsPage() {
	return <RegistriesView />;
}
