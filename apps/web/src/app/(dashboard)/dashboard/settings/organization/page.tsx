import type { Metadata } from "next";

import { DangerZoneCard } from "@/components/settings/organization/danger-zone-card";
import { MembersCard } from "@/components/settings/organization/members-card";
import { OrganizationCard } from "@/components/settings/organization/organization-card";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Organization Settings",
};

export default function OrganizationSettingsPage() {
	return (
		<div className="flex flex-col gap-6">
			<PageHeader title="Organization" description="Manage your organization and its members." />
			<OrganizationCard />
			<MembersCard />
			<DangerZoneCard />
		</div>
	);
}
