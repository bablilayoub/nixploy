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
import { settingsNavItems } from "@/components/nav-settings";
import { OrgSwitcher } from "@/components/org-switcher";
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
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useTRPC } from "@/lib/trpc";

export function TopNav() {
	const pathname = usePathname();
	const { state } = useSidebar();
	const chrome = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!chrome.current) return;
		const root = document.documentElement;
		const update = () =>
			root.style.setProperty(
				"--app-chrome-height",
				`${Math.ceil(chrome.current?.getBoundingClientRect().height ?? 64)}px`,
			);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(chrome.current);
		return () => {
			observer.disconnect();
			root.style.removeProperty("--app-chrome-height");
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
	const setting = settingsNavItems.find((item) => item.href === pathname);
	return (
		<div ref={chrome} className="sticky top-0 z-30 border-b bg-background">
			<header className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
				<div className="flex min-w-0 max-w-full items-center gap-3">
					<SidebarTrigger aria-controls="workspace-navigation" />
					<Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
					<Breadcrumb>
						<BreadcrumbList>
							{setting ? (
								<>
									<BreadcrumbItem>
										<BreadcrumbLink asChild>
											<Link href="/dashboard/settings">Settings</Link>
										</BreadcrumbLink>
									</BreadcrumbItem>
									<BreadcrumbSeparator />
									<BreadcrumbItem>
										<BreadcrumbPage>{setting.label}</BreadcrumbPage>
									</BreadcrumbItem>
								</>
							) : (
								<BreadcrumbItem>
									<BreadcrumbPage>{current?.title ?? "Workspace"}</BreadcrumbPage>
								</BreadcrumbItem>
							)}
						</BreadcrumbList>
					</Breadcrumb>

					<div className={state === "collapsed" ? "hidden md:block" : "hidden"}>
						<OrgSwitcher />
					</div>
				</div>
				<div className="ml-auto flex max-w-full items-center gap-1 sm:gap-2">
					{banner.data?.updateAvailable && banner.data.canManageUpdate && (
						<Button asChild variant="outline" size="sm" className="hidden xl:inline-flex">
							<Link href="/dashboard/settings/server#platform-administration">
								<Download aria-hidden="true" />
								Update available
							</Link>
						</Button>
					)}
					<CommandPalette />
					<ModeToggle />
					<ProfileDropdown />
				</div>
			</header>
		</div>
	);
}
