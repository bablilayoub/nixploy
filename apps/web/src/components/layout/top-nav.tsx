"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Download, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useBranding } from "@/components/branding-provider";
import { CommandPalette } from "@/components/command-palette";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
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
	const banner = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});
	return Boolean(banner.data?.updateAvailable && banner.data?.canManageUpdate);
}

/** One navigation tree serves the desktop rail and the accessible mobile sheet. */
export function TopNav() {
	const pathname = usePathname();
	const { can } = useCapabilities({ strict: true });
	const branding = useBranding();
	const [mobileOpen, setMobileOpen] = useState(false);
	const updateAvailable = useUpdateAvailable();
	const current = sidebarNavGroups
		.flatMap((group) => group.items)
		.find((item) => isSidebarNavActive(pathname, item.url));
	const navigation = (compact: boolean) => (
		<div className="flex h-full min-h-0 flex-col">
			<nav aria-label="Workspace" className="flex-1 space-y-7 overflow-y-auto px-3 py-6">
				{sidebarNavGroups.map((group) => (
					<div key={group.title} className="space-y-2">
						<p
							className={cn(
								"px-3 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase",
								compact && "md:hidden xl:block",
							)}
						>
							{group.title}
						</p>
						{group.items
							.filter((item) => !item.capability || can(item.capability))
							.map((item) => {
								const active = isSidebarNavActive(pathname, item.url);
								const Icon = item.icon;
								return (
									<Link
										key={item.url}
										href={item.url}
										title={compact ? item.title : undefined}
										aria-current={active ? "page" : undefined}
										onClick={() => setMobileOpen(false)}
										className={cn(
											"group flex min-h-11 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-[13px] font-medium transition-colors",
											compact && "md:justify-center md:px-2 xl:justify-start xl:px-3",
											active
												? "border-border bg-card text-foreground shadow-xs"
												: "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
										)}
									>
										<Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.7} />
										<span className={cn(compact && "md:sr-only xl:not-sr-only")}>{item.title}</span>
										{item.url === "/dashboard/settings" && updateAvailable ? (
											<span className="ms-auto size-1.5 rounded-full bg-success">
												<span className="sr-only">Update available</span>
											</span>
										) : null}
									</Link>
								);
							})}
					</div>
				))}
			</nav>
			<div
				className={cn(
					"m-3 rounded-lg border border-border/70 bg-card/60 p-3",
					compact && "md:hidden xl:block",
				)}
			>
				<a
					href="https://nixploy.com/docs"
					target="_blank"
					rel="noreferrer"
					className="flex min-h-11 items-center justify-between gap-3 text-xs font-medium"
				>
					Documentation <ArrowUpRight aria-hidden="true" className="size-3.5" />
				</a>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					A little help, always close.
				</p>
			</div>
		</div>
	);
	return (
		<>
			<aside className="fixed inset-y-0 start-0 z-40 hidden w-20 flex-col border-e bg-sidebar md:flex xl:w-60">
				<Link
					href="/dashboard"
					aria-label={branding.productName}
					className="flex h-20 shrink-0 items-center justify-center border-b px-5 xl:justify-start"
				>
					<span className="hidden xl:block">
						<Logo />
					</span>
					<LogoMark className="size-8 xl:hidden" />
				</Link>
				<div className="hidden border-b px-4 py-4 xl:block">
					<OrgSwitcher />
				</div>
				{navigation(true)}
			</aside>
			<header className="workspace-topbar sticky top-0 z-30 flex min-h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur-md sm:px-6 lg:px-8">
				<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
					<SheetTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="md:hidden"
							aria-label="Open workspace navigation"
						>
							<Menu className="size-5" />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
						<SheetHeader className="border-b p-5 text-start">
							<SheetTitle>
								<Logo />
							</SheetTitle>
							<div className="pt-4">
								<OrgSwitcher />
							</div>
						</SheetHeader>
						{navigation(false)}
					</SheetContent>
				</Sheet>
				<div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
					<span className="hidden sm:inline">Workspace</span>
					<span className="hidden text-border sm:inline">/</span>
					<span className="truncate font-medium text-foreground">
						{current?.title ?? "Projects"}
					</span>
				</div>
				<div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
					{updateAvailable ? (
						<Button asChild variant="outline" size="sm" className="hidden lg:inline-flex">
							<Link href="/dashboard/settings/server">
								<Download className="size-3.5" />
								Update available
							</Link>
						</Button>
					) : null}
					<div className="hidden md:block xl:hidden">
						<OrgSwitcher />
					</div>
					<CommandPalette />
					<ModeToggle />
					<span className="mx-1 h-5 w-px bg-border" />
					<ProfileDropdown />
				</div>
			</header>
		</>
	);
}
