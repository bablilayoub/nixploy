"use client";

import {
	Archive,
	Bell,
	Building2,
	GitBranch,
	KeyRound,
	LayoutGrid,
	Package,
	Server,
	ServerCog,
	ShieldCheck,
	User,
} from "lucide-react";

import { usePathname, useRouter } from "next/navigation";

import { SubNav, type SubNavGroup, type SubNavItem } from "@/components/shell/sub-nav";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

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
		label: "Infrastructure",
		items: [
			{ label: "Servers", href: "/dashboard/settings/servers", icon: Server },
			{ label: "SSH keys", href: "/dashboard/settings/ssh-keys", icon: KeyRound },
			{ label: "Certificates", href: "/dashboard/settings/certificates", icon: ShieldCheck },
		],
	},
	{
		label: "Integrations",
		items: [
			{ label: "Git providers", href: "/dashboard/settings/git-providers", icon: GitBranch },
			{ label: "Registries", href: "/dashboard/settings/registries", icon: Package },
			{ label: "Backup storage", href: "/dashboard/settings/destinations", icon: Archive },
			{ label: "Templates", href: "/dashboard/settings/templates", icon: LayoutGrid },
		],
	},
	// Instance-wide settings (this Nixploy install, not one organization).
	// Only the better-auth instance admin can open them (UX audit F11).
	{
		label: "Instance",
		items: [
			{
				label: "Platform",
				href: "/dashboard/settings/server",
				icon: ServerCog,
				gate: { instanceAdmin: true },
			},
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
 *
 * Below `md` the twelve links become one select (UX audit F19): stacked, the
 * menu pushed every settings page ~700 px down the phone screen, so the page
 * you navigated to was never the first thing you saw.
 */
export function NavSettings({ className }: { className?: string }) {
	const { can, isInstanceAdmin } = useCapabilities();
	const mounted = useMounted();
	const router = useRouter();
	const pathname = usePathname();

	const groups = filterSettingsNavGroups(settingsNavGroups, {
		can,
		isInstanceAdmin: mounted && isInstanceAdmin,
	});
	const items = groups.flatMap((group) => group.items);
	const current =
		items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href ??
		items[0]?.href;

	return (
		<>
			<div className={cn("md:hidden", className)}>
				<Select value={current} onValueChange={(href) => router.push(href)}>
					<SelectTrigger className="w-full" aria-label="Settings page">
						<SelectValue placeholder="Settings" />
					</SelectTrigger>
					<SelectContent>
						{groups.map((group) => (
							<SelectGroup key={group.label}>
								<SelectLabel>{group.label}</SelectLabel>
								{group.items.map((item) => (
									<SelectItem key={item.href} value={item.href}>
										{item.label}
									</SelectItem>
								))}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>
			</div>
			<SubNav orientation="vertical" groups={groups} className={cn("hidden md:flex", className)} />
		</>
	);
}
