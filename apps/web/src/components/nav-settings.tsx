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
import { useEffect, useState } from "react";

import { SubNav, type SubNavGroup, type SubNavItem } from "@/components/shell/sub-nav";
import { useCapabilities } from "@/hooks/use-capabilities";

/** Who may open a settings page. Read views stay open to every member. */
export interface SettingsNavGate {
	/** Org capability the page's queries require. */
	capability?: string;
	/** Page only works for the instance admin (better-auth admin role). */
	instanceAdmin?: boolean;
}

export interface SettingsNavItem extends SubNavItem {
	gate?: SettingsNavGate;
}

export interface SettingsNavGroup extends SubNavGroup {
	items: SettingsNavItem[];
}

/**
 * Settings side menu — grouped so related pages sit together.
 * Routes stay stable; labels prefer findability over historical names.
 */
export const settingsNavGroups: SettingsNavGroup[] = [
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
			{
				label: "Audit log",
				href: "/dashboard/settings/activity",
				icon: Activity,
				gate: { capability: "audit.read" },
			},
		],
	},
	{
		label: "Infrastructure",
		items: [
			{ label: "Servers", href: "/dashboard/settings/servers", icon: Server },
			{ label: "SSH keys", href: "/dashboard/settings/ssh-keys", icon: KeyRound },
			{ label: "Certificates", href: "/dashboard/settings/certificates", icon: ShieldCheck },
			{
				label: "Platform",
				href: "/dashboard/settings/server",
				icon: ServerCog,
				gate: { instanceAdmin: true },
			},
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
export const settingsNavItems: SettingsNavItem[] = settingsNavGroups.flatMap(
	(group) => group.items,
);

export function isSettingsNavItemAllowed(
	item: SettingsNavItem,
	access: { can: (capability: string) => boolean; isInstanceAdmin: boolean },
): boolean {
	const gate = item.gate;
	if (!gate) return true;
	if (gate.instanceAdmin && !access.isInstanceAdmin) return false;
	if (gate.capability && !access.can(gate.capability)) return false;
	return true;
}

/** Drop pages the caller cannot use; groups left empty disappear too. */
export function filterSettingsNavGroups(
	groups: SettingsNavGroup[],
	access: { can: (capability: string) => boolean; isInstanceAdmin: boolean },
): SettingsNavGroup[] {
	return groups
		.map((group) => ({
			...group,
			items: group.items.filter((item) => isSettingsNavItemAllowed(item, access)),
		}))
		.filter((group) => group.items.length > 0);
}

/**
 * Settings sub-navigation — vertical side menu on settings pages, filtered by
 * the caller's capabilities. Instance-admin pages only appear after mount so
 * the server-rendered markup (no session yet) matches the first client paint.
 */
export function NavSettings({ className }: { className?: string }) {
	const { can, isInstanceAdmin } = useCapabilities();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const groups = filterSettingsNavGroups(settingsNavGroups, {
		can,
		isInstanceAdmin: mounted && isInstanceAdmin,
	});

	return <SubNav orientation="vertical" groups={groups} className={className} />;
}
