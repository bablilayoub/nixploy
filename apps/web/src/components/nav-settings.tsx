"use client";

import {
	Activity,
	Archive,
	Bell,
	Building2,
	GitBranch,
	KeyRound,
	Package,
	Server,
	ServerCog,
	ShieldCheck,
	TriangleAlert,
	User,
} from "lucide-react";

import { SubNav, type SubNavGroup, type SubNavItem } from "@/components/shell/sub-nav";

/**
 * Settings side menu — grouped so related pages sit together.
 * Routes stay stable; labels prefer findability over historical names.
 */
export const settingsNavGroups: SubNavGroup[] = [
	{
		label: "Account",
		items: [{ label: "Profile", href: "/dashboard/settings/profile", icon: User }],
	},
	{
		label: "Organization",
		items: [
			{ label: "General", href: "/dashboard/settings/organization", icon: Building2 },
			{ label: "Notifications", href: "/dashboard/settings/notifications", icon: Bell },
		],
	},
	{
		label: "Observability",
		items: [
			{ label: "Incidents", href: "/dashboard/settings/incidents", icon: TriangleAlert },
			{ label: "Audit log", href: "/dashboard/settings/activity", icon: Activity },
		],
	},
	{
		label: "Infrastructure",
		items: [
			{ label: "Servers", href: "/dashboard/settings/servers", icon: Server },
			{ label: "SSH keys", href: "/dashboard/settings/ssh-keys", icon: KeyRound },
			{ label: "Certificates", href: "/dashboard/settings/certificates", icon: ShieldCheck },
			{ label: "Platform", href: "/dashboard/settings/server", icon: ServerCog },
		],
	},
	{
		label: "Integrations",
		items: [
			{ label: "Git providers", href: "/dashboard/settings/git-providers", icon: GitBranch },
			{ label: "Registries", href: "/dashboard/settings/registries", icon: Package },
			{ label: "Backup storage", href: "/dashboard/settings/destinations", icon: Archive },
		],
	},
];

/** Flat list for command palette and any consumer that does not need groups. */
export const settingsNavItems: SubNavItem[] = settingsNavGroups.flatMap((group) => group.items);

/** Settings sub-navigation — vertical side menu on settings pages. */
export function NavSettings() {
	return <SubNav orientation="vertical" groups={settingsNavGroups} />;
}
