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
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** Fieldwork keeps the entire workspace in the same horizontal frame. */
export function TopNav() {
	const pathname = usePathname();
	const { can } = useCapabilities({ strict: true });
	const branding = useBranding();
	const [mobileOpen, setMobileOpen] = useState(false);
	const trpc = useTRPC();
	const banner = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});
	const updateAvailable = Boolean(banner.data?.updateAvailable && banner.data?.canManageUpdate);
	const items = sidebarNavGroups
		.flatMap((group) => group.items)
		.filter((item) => !item.capability || can(item.capability));
	return (
		<div className="fieldwork-chrome">
			<header className="workspace-topbar fieldwork-identity">
				<div className="fieldwork-identity-inner">
					<div className="fieldwork-identity-start">
						<Link href="/dashboard" aria-label={branding.productName} className="fieldwork-logo">
							<Logo />
						</Link>
						<span className="fieldwork-brand-divider" aria-hidden="true" />
						<OrgSwitcher className="fieldwork-org-switcher" />
					</div>
					<div className="fieldwork-identity-tools">
						{updateAvailable && (
							<Button asChild variant="outline" size="sm" className="hidden xl:inline-flex">
								<Link href="/dashboard/settings/server">
									<Download aria-hidden="true" className="size-3.5" />
									Update available
								</Link>
							</Button>
						)}
						<CommandPalette className="fieldwork-command" />
						<ModeToggle />
						<div className="fieldwork-account">
							<ProfileDropdown />
						</div>
						<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
							<SheetTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="lg:hidden"
									aria-label="Open workspace navigation"
								>
									<Menu className="size-5" />
								</Button>
							</SheetTrigger>
							<SheetContent
								side="right"
								className="flex w-80 max-w-[calc(100vw-24px)] flex-col gap-0 p-0"
							>
								<SheetHeader className="border-b px-6 py-6 text-start">
									<SheetTitle>Workspace navigation</SheetTitle>
									<div className="mt-3">
										<OrgSwitcher />
									</div>
								</SheetHeader>
								<nav aria-label="Workspace mobile" className="flex-1 space-y-1 overflow-y-auto p-4">
									{items.map((item) => (
										<Link
											key={item.url}
											href={item.url}
											aria-current={isSidebarNavActive(pathname, item.url) ? "page" : undefined}
											onClick={() => setMobileOpen(false)}
											className={cn(
												"flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm",
												isSidebarNavActive(pathname, item.url)
													? "bg-accent font-medium text-foreground"
													: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
											)}
										>
											<item.icon aria-hidden="true" className="size-4" strokeWidth={1.6} />
											{item.title}
										</Link>
									))}
								</nav>
								<div className="mx-6 mb-5 flex items-center justify-between gap-4 border-t pt-4 flex-wrap">
									<a
										href={branding.docsUrl ?? "https://nixploy.com/docs"}
										target="_blank"
										rel="noreferrer"
										className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground hover:text-foreground"
									>
										Documentation
										<ArrowUpRight aria-hidden="true" className="size-4" />
									</a>
									<ProfileDropdown onNavigate={() => setMobileOpen(false)} />
								</div>
							</SheetContent>
						</Sheet>
					</div>
				</div>
			</header>
			<div className="fieldwork-primary-row">
				<div className="fieldwork-primary-inner">
					<nav aria-label="Workspace" className="fieldwork-primary-nav">
						{items.map((item) => (
							<Link
								key={item.url}
								href={item.url}
								aria-current={isSidebarNavActive(pathname, item.url) ? "page" : undefined}
								className="fieldwork-primary-link"
							>
								{item.title}
								{item.url === "/dashboard/settings" && updateAvailable && (
									<span className="size-1.5 rounded-full bg-success">
										<span className="sr-only">Update available</span>
									</span>
								)}
							</Link>
						))}
					</nav>
					<a
						href={branding.docsUrl ?? "https://nixploy.com/docs"}
						target="_blank"
						rel="noreferrer"
						className="fieldwork-docs-link"
					>
						Documentation
						<ArrowUpRight aria-hidden="true" className="size-3.5" />
					</a>
				</div>
			</div>
		</div>
	);
}
