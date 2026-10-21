import type { Metadata } from "next";
import { SectionLinks } from "@/components/layout/section-links";
import { SettingsStack } from "@/components/layout/settings-section";
import { DangerZoneCard } from "@/components/settings/organization/danger-zone-card";
import { MembersCard } from "@/components/settings/organization/members-card";
import { OrganizationCard } from "@/components/settings/organization/organization-card";
import { QuotasCard } from "@/components/settings/organization/quotas-card";
import { SecurityCard } from "@/components/settings/organization/security-card";
import { SharedVariablesCard } from "@/components/settings/organization/shared-variables-card";
import { TeamsCard } from "@/components/settings/organization/teams-card";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Organization Settings",
};

export default function OrganizationSettingsPage() {
	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Organization"
				description="Name, members, roles, capabilities, and teams."
			/>
			<SectionLinks
				items={[
					{ id: "organization-details", label: "Organization details" },
					{ id: "organization-access", label: "People and access" },
					{ id: "organization-danger", label: "Delete organization" },
				]}
			/>
			<section id="organization-details" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>Organization details</h2>
					<p>Identity, resource limits and shared configuration.</p>
				</header>
				<SettingsStack>
					<OrganizationCard />
					<QuotasCard />
					<SharedVariablesCard />
				</SettingsStack>
			</section>
			<section id="organization-access" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>People and access</h2>
					<p>Membership, team scope and organization security policy.</p>
				</header>
				<SettingsStack>
					<MembersCard />
					<TeamsCard />
					<SecurityCard />
				</SettingsStack>
			</section>
			<section id="organization-danger" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>Delete organization</h2>
					<p>Permanent actions affecting this organization.</p>
				</header>
				<SettingsStack>
					<DangerZoneCard />
				</SettingsStack>
			</section>
		</div>
	);
}
