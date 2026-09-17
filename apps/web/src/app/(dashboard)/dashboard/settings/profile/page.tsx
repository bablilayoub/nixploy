import type { Metadata } from "next";
import { SettingsStack } from "@/components/layout/settings-section";
import { ApiKeysCard } from "@/components/settings/profile/api-keys-card";
import { McpSetupCard } from "@/components/settings/profile/mcp-setup-card";
import { ChangePasswordCard, ProfileCard } from "@/components/settings/profile/profile-card";
import { SessionsCard } from "@/components/settings/profile/sessions-card";
import { TwoFactorCard } from "@/components/settings/profile/two-factor-card";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = {
	title: "Profile Settings",
};

export default function ProfileSettingsPage() {
	return (
		<div className="flex flex-col gap-8">
			<PageHeader title="Profile" description="Manage your account, security and API access." />
			<SettingsStack>
				<ProfileCard />
				<ChangePasswordCard />
				<TwoFactorCard />
				<SessionsCard />
				<ApiKeysCard />
				<McpSetupCard />
			</SettingsStack>
		</div>
	);
}
