import type { Metadata } from "next";
import { SectionLinks } from "@/components/layout/section-links";
import { SettingsStack } from "@/components/layout/settings-section";
import { ApiKeysCard } from "@/components/settings/profile/api-keys-card";
import { McpSetupCard } from "@/components/settings/profile/mcp-setup-card";
import { PasskeysCard } from "@/components/settings/profile/passkeys-card";
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
			<SectionLinks
				items={[
					{ id: "account", label: "Account" },
					{ id: "security", label: "Sign-in and security" },
					{ id: "developer-access", label: "Developer access" },
				]}
			/>
			<section id="account" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>Account</h2>
					<p>Your name, email and account details.</p>
				</header>
				<SettingsStack>
					<ProfileCard />
				</SettingsStack>
			</section>
			<section id="security" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>Sign-in and security</h2>
					<p>Password, passkeys, two-factor authentication and active sessions.</p>
				</header>
				<SettingsStack>
					<ChangePasswordCard />
					<PasskeysCard />
					<TwoFactorCard />
					<SessionsCard />
				</SettingsStack>
			</section>
			<section id="developer-access" tabIndex={-1} className="fieldwork-form-group">
				<header>
					<h2>Developer access</h2>
					<p>API keys and connections for your tools.</p>
				</header>
				<SettingsStack>
					<ApiKeysCard />
					<McpSetupCard />
				</SettingsStack>
			</section>
		</div>
	);
}
