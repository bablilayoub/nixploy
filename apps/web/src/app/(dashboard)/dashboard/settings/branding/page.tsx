import type { Metadata } from "next";
import { SettingsStack } from "@/components/layout/settings-section";
import { BrandingCard } from "@/components/settings/branding/branding-card";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Branding",
};

export default function BrandingSettingsPage() {
	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Branding"
				description="Make this instance yours: product name, logos, favicon, colours and copy."
			/>
			<SettingsStack>
				<BrandingCard />
			</SettingsStack>
		</div>
	);
}
