import {
	Activity,
	CalendarClock,
	Container,
	FolderGit2,
	LayoutTemplate,
	type LucideIcon,
	Settings,
} from "lucide-react";

export type SidebarNavItem = {
	title: string;
	url: string;
	icon: LucideIcon;
};

export type SidebarNavGroup = {
	title: string;
	items: SidebarNavItem[];
};

export const sidebarNavGroups: SidebarNavGroup[] = [
	{
		title: "Platform",
		items: [
			{ title: "Projects", url: "/dashboard", icon: FolderGit2 },
			{ title: "Templates", url: "/dashboard/templates", icon: LayoutTemplate },
			{ title: "Docker", url: "/dashboard/docker", icon: Container },
			{ title: "Monitoring", url: "/dashboard/monitoring", icon: Activity },
			{ title: "Schedules", url: "/dashboard/schedules", icon: CalendarClock },
		],
	},
	{
		title: "Account",
		items: [{ title: "Settings", url: "/dashboard/settings", icon: Settings }],
	},
];

export function isSidebarNavActive(pathname: string, url: string) {
	if (url === "/dashboard") {
		return pathname === "/dashboard" || pathname.startsWith("/dashboard/projects");
	}
	return pathname === url || pathname.startsWith(`${url}/`);
}
