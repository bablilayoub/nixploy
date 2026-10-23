"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CommandPalette } from "@/components/command-palette";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
import { ModeToggle } from "@/components/mode-toggle";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTRPC } from "@/lib/trpc";

export function TopNav() {
	const pathname = usePathname();
	const chrome = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!chrome.current) return;
		const root = document.documentElement;
		const update = () =>
			root.style.setProperty(
				"--fieldwork-chrome-height",
				`${Math.ceil(chrome.current?.getBoundingClientRect().height ?? 64)}px`,
			);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(chrome.current);
		return () => {
			observer.disconnect();
			root.style.removeProperty("--fieldwork-chrome-height");
		};
	}, []);
	const trpc = useTRPC();
	const banner = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});
	const current = sidebarNavGroups
		.flatMap((g) => g.items)
		.find((item) => isSidebarNavActive(pathname, item.url));
	return (
		<div ref={chrome} className="sticky top-0 z-30 bg-background">
			<header className="flex min-h-16 min-w-0 items-center justify-between gap-3 border-b border-border/50 px-4 sm:px-6">
				<div className="flex min-w-0 items-center gap-3">
					<SidebarTrigger className="size-11 shrink-0" aria-controls="workspace-navigation" />
					<Separator orientation="vertical" className="h-5" />
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem className="hidden md:block">
								<BreadcrumbLink asChild>
									<Link href="/dashboard">Workspace</Link>
								</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator className="hidden md:block" />
							<BreadcrumbItem>
								<BreadcrumbPage>{current?.title ?? "Workspace"}</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				</div>
				<div className="flex shrink-0 items-center gap-1 sm:gap-2">
					{banner.data?.updateAvailable && banner.data.canManageUpdate && (
						<Button asChild variant="outline" size="sm" className="hidden xl:inline-flex">
							<Link href="/dashboard/settings/server">
								<Download aria-hidden="true" />
								Update available
							</Link>
						</Button>
					)}
					<CommandPalette className="mono-command" />
					<ModeToggle />
					<ProfileDropdown />
				</div>
			</header>
		</div>
	);
}
