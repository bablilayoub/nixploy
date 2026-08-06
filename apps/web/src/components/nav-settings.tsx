"use client";

import { SubNav, type SubNavItem } from "@/components/shell/sub-nav";

export const settingsNavItems: SubNavItem[] = [
	{ label: "Profile", href: "/dashboard/settings/profile" },
	{ label: "Organization", href: "/dashboard/settings/organization" },
	{ label: "Activity", href: "/dashboard/settings/activity" },
	{ label: "Incidents", href: "/dashboard/settings/incidents" },
	{ label: "Servers", href: "/dashboard/settings/servers" },
	{ label: "Web Server", href: "/dashboard/settings/server" },
	{ label: "SSH Keys", href: "/dashboard/settings/ssh-keys" },
	{ label: "Certificates", href: "/dashboard/settings/certificates" },
	{ label: "Git Providers", href: "/dashboard/settings/git-providers" },
	{ label: "Registries", href: "/dashboard/settings/registries" },
	{ label: "Destinations", href: "/dashboard/settings/destinations" },
	{ label: "Notifications", href: "/dashboard/settings/notifications" },
];

/** Settings sub-navigation rendered as horizontal tabs under the top navbar. */
export function NavSettings() {
	return <SubNav items={settingsNavItems} />;
}
