import type { Metadata } from "next";
import { FocusSections } from "@/components/layout/focus-sections";
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
			<FocusSections
				items={[
					{ id: "organization-details", label: "General" },
					{ id: "organization-access", label: "People and access" },
					{ id: "organization-limits", label: "Resource limits" },
					{ id: "organization-variables", label: "Shared variables" },
					{ id: "organization-danger", label: "Delete organization" },
				]}
			>
				<section id="organization-details" tabIndex={-1} className="fieldwork-form-group">
					<SettingsStack>
						<OrganizationCard />
					</SettingsStack>
				</section>
				<section id="organization-access" tabIndex={-1} className="fieldwork-form-group">
					<SettingsStack>
						<MembersCard />
						<TeamsCard />
						<SecurityCard />
					</SettingsStack>
				</section>
				<section id="organization-limits" className="fieldwork-form-group">
					<SettingsStack>
						<QuotasCard />
					</SettingsStack>
				</section>
				<section id="organization-variables" className="fieldwork-form-group">
					<SettingsStack>
						<SharedVariablesCard />
					</SettingsStack>
				</section>
				<section id="organization-danger" tabIndex={-1} className="fieldwork-form-group">
					<SettingsStack>
						<DangerZoneCard />
					</SettingsStack>
				</section>
			</FocusSections>
		</div>
	);
}
