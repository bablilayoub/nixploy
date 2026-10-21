"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Menu } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const allNavItems = sidebarNavGroups.flatMap((group) => group.items);

function useUpdateAvailable() {
	const trpc = useTRPC();
	const bannerQuery = useQuery({
		...trpc.updates.banner.queryOptions(),
		refetchInterval: 5 * 60_000,
		retry: false,
	});
	return Boolean(bannerQuery.data?.updateAvailable) && Boolean(bannerQuery.data?.canManageUpdate);
}

function NavLink({
	href,
	label,
	active,
	onNavigate,
	badge,
}: {
	href: string;
	label: string;
	active: boolean;
	onNavigate?: () => void;
	badge?: boolean;
}) {
	return (
		<Link
			href={href}
			aria-current={active ? "page" : undefined}
			onClick={onNavigate}
			className={cn(
				"relative inline-flex h-full items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				active
					? "font-medium text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-brand"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{label}
			{badge ? (
				<span className="relative flex size-1.5">
					<span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
					<span className="relative inline-flex size-1.5 rounded-full bg-success" />
				</span>
			) : null}
		</Link>
	);
}

/** Shared workspace navigation with the same destinations at every viewport. */
export function TopNav() {
	const pathname = usePathname();
	const { can } = useCapabilities({ strict: true });
	const navItems = allNavItems.filter((item) => !item.capability || can(item.capability));
	const branding = useBranding();
	const [mobileOpen, setMobileOpen] = useState(false);
	const updateAvailable = useUpdateAvailable();

	return (
		<header className="workspace-header sticky top-0 z-50 border-b bg-card">
			<div className="mx-auto flex min-h-15 w-full max-w-[1460px] flex-wrap items-center gap-2 px-5 py-2 md:min-h-17 md:gap-3 md:px-8 xl:px-9">
				<div className="flex min-w-0 flex-1 items-center gap-2 xl:flex-none">
					<Link href="/dashboard" className="hidden shrink-0 sm:inline-flex">
						<Logo />
					</Link>
					<Link
						href="/dashboard"
						className="inline-flex shrink-0 sm:hidden"
						aria-label={branding.productName}
					>
						<LogoMark className="size-7" />
					</Link>
					<Separator orientation="vertical" className="hidden h-4 sm:block" />
					<OrgSwitcher />
				</div>

				<nav
					aria-label="Main navigation"
					className="workspace-desktop-nav -my-2 ms-1 hidden h-17 items-center gap-0.5"
				>
					{navItems.map((item) => (
						<NavLink
							key={item.url}
							href={item.url}
							label={item.title}
							active={isSidebarNavActive(pathname, item.url)}
							badge={item.url === "/dashboard/settings" ? updateAvailable : false}
						/>
					))}
				</nav>

				<div className="ms-auto flex max-w-full flex-wrap items-center gap-1.5">
					{updateAvailable ? (
						<Button
							asChild
							variant="outline"
							size="sm"
							className="hidden h-8 gap-1.5 lg:inline-flex"
						>
							<Link href="/dashboard/settings/server">
								<Download className="size-3.5" />
								Update
							</Link>
						</Button>
					) : null}
					<CommandPalette />
					<ModeToggle />
					<ProfileDropdown />

					<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
						<SheetTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="workspace-menu-trigger"
								aria-label="Open menu"
							>
								<Menu className="size-5" />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-72 p-0">
							<SheetHeader className="border-b py-3 ps-4 pe-14 text-start">
								<SheetTitle className="flex items-center gap-2 wrap-anywhere">
									<LogoMark className="size-5" />
									{branding.productName}
								</SheetTitle>
							</SheetHeader>
							<nav aria-label="Main navigation" className="flex flex-col gap-1 p-3">
								{navItems.map((item) => {
									const Icon = item.icon;
									const active = isSidebarNavActive(pathname, item.url);
									return (
										<Link
											key={item.url}
											href={item.url}
											aria-current={active ? "page" : undefined}
											onClick={() => setMobileOpen(false)}
											className={cn(
												"flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
												active
													? "bg-muted font-medium text-foreground"
													: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
											)}
										>
											<Icon className="size-4 shrink-0" />
											{item.title}
											{item.url === "/dashboard/settings" && updateAvailable ? (
												<span className="ms-auto size-1.5 rounded-full bg-success" />
											) : null}
										</Link>
									);
								})}
							</nav>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		</header>
	);
}
