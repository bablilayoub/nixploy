"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useBranding } from "@/components/branding-provider";
import { CommandPalette } from "@/components/command-palette";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import {
	isSidebarNavActive,
	type SidebarNavGroup,
	sidebarNavGroups,
} from "@/components/layout/sidebar-data";
import { ModeToggle } from "@/components/mode-toggle";
import { OrgSwitcher } from "@/components/org-switcher";
import { Logo, LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function useUpdateAvailable() {
	const trpc = useTRPC();
	const bannerQuery = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});
	return Boolean(bannerQuery.data?.updateAvailable) && Boolean(bannerQuery.data?.canManageUpdate);
}

function WorkspaceNavigation({
	groups,
	pathname,
	updateAvailable,
	onNavigate,
}: {
	groups: SidebarNavGroup[];
	pathname: string;
	updateAvailable: boolean;
	onNavigate?: () => void;
}) {
	return (
		<nav aria-label="Main navigation" className="flex flex-col gap-7 px-3 py-6">
			{groups.map((group) => (
				<div key={group.title} className="space-y-2">
					<p className="px-3 text-xs font-medium text-muted-foreground">{group.title}</p>
					<div className="space-y-1">
						{group.items.map((item) => {
							const active = isSidebarNavActive(pathname, item.url);
							const Icon = item.icon;
							return (
								<Link
									key={item.url}
									href={item.url}
									aria-current={active ? "page" : undefined}
									onClick={onNavigate}
									className={cn(
										"flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
										active
											? "status-spine bg-selection font-semibold text-foreground"
											: "text-shell-foreground hover:bg-card/70 hover:text-foreground",
									)}
								>
									<Icon aria-hidden className="size-4 shrink-0" />
									{item.title}
									{item.url === "/dashboard/settings" && updateAvailable ? (
										<span className="ms-auto size-1.5 rounded-full bg-success" />
									) : null}
								</Link>
							);
						})}
					</div>
				</div>
			))}
		</nav>
	);
}

/** Persistent desktop context and the same navigation in a mobile sheet. */
export function TopNav() {
	const pathname = usePathname();
	const { can } = useCapabilities({ strict: true });
	const navGroups = sidebarNavGroups
		.map((group) => ({
			...group,
			items: group.items.filter((item) => !item.capability || can(item.capability)),
		}))
		.filter((group) => group.items.length > 0);
	const branding = useBranding();
	const [mobileOpen, setMobileOpen] = useState(false);
	const updateAvailable = useUpdateAvailable();

	return (
		<>
			<aside className="fixed inset-y-0 start-0 z-40 hidden w-52 flex-col border-e border-border bg-shell lg:flex">
				<Link
					href="/dashboard"
					className="flex h-14 shrink-0 items-center border-b border-border px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				>
					<Logo className="[&>span:last-child]:text-base" />
				</Link>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<WorkspaceNavigation
						groups={navGroups}
						pathname={pathname}
						updateAvailable={updateAvailable}
					/>
				</div>
			</aside>

			<header className="sticky top-0 z-40 border-b border-border bg-card">
				<div className="flex h-14 min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-6">
					<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
								<Menu className="size-5" />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-72 bg-shell p-0">
							<SheetHeader className="border-b px-5 py-4 text-start">
								<SheetTitle>
									<Logo />
								</SheetTitle>
							</SheetHeader>
							<WorkspaceNavigation
								groups={navGroups}
								pathname={pathname}
								updateAvailable={updateAvailable}
								onNavigate={() => setMobileOpen(false)}
							/>
						</SheetContent>
					</Sheet>
					<Link
						href="/dashboard"
						className="hidden shrink-0 sm:inline-flex lg:hidden"
						aria-label={branding.productName}
					>
						<LogoMark className="size-6" />
					</Link>
					<div className="min-w-0 flex-1">
						<OrgSwitcher className="max-w-full" />
					</div>
					<div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
						{updateAvailable ? (
							<Button asChild variant="outline" size="sm" className="hidden gap-1.5 xl:inline-flex">
								<Link href="/dashboard/settings/server">
									<Download className="size-3.5" />
									Update
								</Link>
							</Button>
						) : null}
						<CommandPalette className="min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
						<ModeToggle />
						<ProfileDropdown />
					</div>
				</div>
			</header>
		</>
	);
}
