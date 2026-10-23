"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useBranding } from "@/components/branding-provider";
import { CommandPalette } from "@/components/command-palette";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
import { ModeToggle } from "@/components/mode-toggle";
import { OrgSwitcher } from "@/components/org-switcher";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import {
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";

export function TopNav() {
	const pathname = usePathname();
	const branding = useBranding();
	const { can } = useCapabilities({ strict: true });
	const chrome = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!chrome.current) return;
		const root = document.documentElement;
		const update = () =>
			root.style.setProperty(
				"--app-chrome-height",
				`${Math.ceil(chrome.current?.getBoundingClientRect().height ?? 112)}px`,
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
	const items = sidebarNavGroups
		.flatMap((group) => group.items)
		.filter((item) => !item.capability || can(item.capability));
	const current = items.find((item) => isSidebarNavActive(pathname, item.url));
	return (
		<div ref={chrome} className="sticky top-0 z-30 border-b bg-background">
			<header className="mx-auto flex min-h-16 w-full max-w-screen-2xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-10">
				<div className="flex min-w-0 max-w-full items-center gap-3 [&>button:last-child]:min-w-0">
					<SidebarTrigger className="shrink-0 md:hidden" aria-controls="workspace-navigation" />
					<Link
						href="/dashboard"
						aria-label={branding.productName}
						className="hidden min-w-0 max-w-36 items-center sm:flex"
					>
						<Logo />
					</Link>
					<Separator orientation="vertical" className="hidden h-6 sm:block" />
					<OrgSwitcher className="max-w-full" />
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
					<Button asChild variant="ghost" size="sm" className="hidden xl:inline-flex">
						<a
							href={branding.docsUrl ?? "https://nixploy.com/docs"}
							target="_blank"
							rel="noreferrer"
						>
							Documentation
						</a>
					</Button>
					<CommandPalette />
					<ModeToggle />
					<ProfileDropdown />
				</div>
			</header>
			<div className="mx-auto hidden w-full min-w-0 max-w-screen-2xl overflow-x-auto px-4 pb-2 md:block sm:px-6 lg:px-10">
				<NavigationMenu
					aria-label="Workspace navigation"
					className="max-w-full justify-start"
					viewport={false}
				>
					<NavigationMenuList>
						{items.map((item) => (
							<NavigationMenuItem key={item.url}>
								<NavigationMenuLink active={current?.url === item.url} asChild>
									<Link
										href={item.url}
										aria-current={current?.url === item.url ? "page" : undefined}
									>
										{item.title}
									</Link>
								</NavigationMenuLink>
							</NavigationMenuItem>
						))}
					</NavigationMenuList>
				</NavigationMenu>
			</div>
		</div>
	);
}
