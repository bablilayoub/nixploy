"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	CalendarClock,
	Container,
	Download,
	FolderGit2,
	LayoutTemplate,
	type LucideIcon,
	Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export const mainNavItems: {
	label: string;
	href: string;
	icon: LucideIcon;
}[] = [
	{ label: "Projects", href: "/dashboard", icon: FolderGit2 },
	{ label: "Templates", href: "/dashboard/templates", icon: LayoutTemplate },
	{ label: "Docker", href: "/dashboard/docker", icon: Container },
	{ label: "Monitoring", href: "/dashboard/monitoring", icon: Activity },
	{ label: "Schedules", href: "/dashboard/schedules", icon: CalendarClock },
	{ label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function isMainNavActive(pathname: string, href: string) {
	if (href === "/dashboard") {
		return pathname === "/dashboard" || pathname.startsWith("/dashboard/projects");
	}
	return pathname === href || pathname.startsWith(`${href}/`);
}

function NavFooter() {
	const trpc = useTRPC();
	const bannerQuery = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});

	const version = bannerQuery.data?.appVersion;
	const showUpdate =
		Boolean(bannerQuery.data?.updateAvailable) && Boolean(bannerQuery.data?.canManageUpdate);

	return (
		<div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border pt-3">
			{showUpdate ? (
				<Button asChild variant="outline" size="sm" className="relative w-full justify-start gap-2">
					<Link href="/dashboard/settings/server">
						<Download className="size-4 shrink-0" />
						<span className="truncate font-medium">Update Available</span>
						<span className="absolute right-2 flex size-2">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
							<span className="relative inline-flex size-2 rounded-full bg-success" />
						</span>
					</Link>
				</Button>
			) : null}
			{version ? (
				<p className="px-1 text-center text-[11px] text-muted-foreground tabular-nums">
					v{version}
				</p>
			) : null}
		</div>
	);
}

/** Primary navigation — vertical left rail (desktop). */
export function NavMain({ className }: { className?: string }) {
	const pathname = usePathname();

	return (
		<nav
			className={cn(
				"hidden w-52 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground md:flex",
				"sticky top-14 h-[calc(100svh-3.5rem)]",
				className,
			)}
			aria-label="Main"
		>
			<div className="flex min-h-0 flex-1 flex-col gap-0.5">
				{mainNavItems.map((item) => {
					const Icon = item.icon;
					const active = isMainNavActive(pathname, item.href);
					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								"flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
								active
									? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
									: "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
							)}
						>
							<Icon
								className={cn(
									"size-4 shrink-0",
									active ? "text-sidebar-foreground" : "text-muted-foreground",
								)}
								aria-hidden
							/>
							{item.label}
						</Link>
					);
				})}
			</div>
			<NavFooter />
		</nav>
	);
}

export { NavMain as NavProjects };
