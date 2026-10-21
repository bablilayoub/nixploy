import type { Metadata } from "next";
import { SsoProvidersView } from "@/components/settings/sso/sso-providers-view";

export const metadata: Metadata = {
	title: "Single sign-on",
};

export default function SsoSettingsPage() {
	return <SsoProvidersView />;
}
