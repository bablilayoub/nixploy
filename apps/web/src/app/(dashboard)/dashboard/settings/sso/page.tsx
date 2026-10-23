import type { Metadata } from "next";
import { SettingsStack } from "@/components/layout/settings-section";
import { SsoProvidersView } from "@/components/settings/sso/sso-providers-view";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Single sign-on",
};

export default function SsoSettingsPage() {
	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Single sign-on"
				description="Identity providers for this instance. Requiring SSO is per organization, under Organization → General."
			/>
			<SettingsStack>
				<SsoProvidersView />
			</SettingsStack>
		</div>
	);
}
