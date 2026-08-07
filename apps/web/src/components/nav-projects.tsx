import {
	isSidebarNavActive,
	type SidebarNavGroup,
	type SidebarNavItem,
	sidebarNavGroups,
} from "@/components/layout/sidebar-data";

export {
	isSidebarNavActive as isMainNavActive,
	type SidebarNavGroup,
	type SidebarNavItem,
	sidebarNavGroups,
};

/** Flat list for command palette / legacy imports. */
export const mainNavItems = sidebarNavGroups.flatMap((group) =>
	group.items.map((item) => ({
		label: item.title,
		href: item.url,
		icon: item.icon,
	})),
);
