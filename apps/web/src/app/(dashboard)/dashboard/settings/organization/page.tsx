import type { Metadata } from "next";

import { DangerZoneCard } from "@/components/settings/organization/danger-zone-card";
import { MembersCard } from "@/components/settings/organization/members-card";
import { OrganizationCard } from "@/components/settings/organization/organization-card";
import { QuotasCard } from "@/components/settings/organization/quotas-card";
import { SecurityCard } from "@/components/settings/organization/security-card";
import { SharedVariablesCard } from "@/components/settings/organization/shared-variables-card";
import { SettingsStack } from "@/components/settings/settings-section";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Organization Settings",
};

export default function OrganizationSettingsPage() {
	return (
		<div className="flex flex-col gap-8">
			<PageHeader title="Organization" description="Name, members, roles, and capabilities." />
			<SettingsStack>
				<OrganizationCard />
				<QuotasCard />
				<SharedVariablesCard />
				<SecurityCard />
				<MembersCard />
				<DangerZoneCard />
			</SettingsStack>
		</div>
	);
}
