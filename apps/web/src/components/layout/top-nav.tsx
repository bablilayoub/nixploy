"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CommandPalette } from "@/components/command-palette";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
import { ModeToggle } from "@/components/mode-toggle";
import { OrgSwitcher } from "@/components/org-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const navItems = sidebarNavGroups.flatMap((group) => group.items);

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
			onClick={onNavigate}
			className={cn(
				"relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
				active
					? "bg-muted font-medium text-foreground"
					: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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

/** Vercel-style sticky top navigation — brand, links, search, account. */
export function TopNav() {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const updateAvailable = useUpdateAvailable();

	return (
		<header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
			<div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
				<div className="flex min-w-0 items-center gap-2">
					<Link
						href="/dashboard"
						className="hidden shrink-0 text-sm font-semibold tracking-tight sm:inline"
					>
						Nixploy
					</Link>
					<Separator orientation="vertical" className="hidden h-4 sm:block" />
					<OrgSwitcher />
				</div>

				<nav className="ms-1 hidden items-center gap-0.5 md:flex">
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

				<div className="ms-auto flex items-center gap-1.5">
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
							<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
								<Menu className="size-5" />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-72 p-0">
							<SheetHeader className="border-b px-4 py-3 text-start">
								<SheetTitle>Nixploy</SheetTitle>
							</SheetHeader>
							<nav className="flex flex-col gap-1 p-3">
								{navItems.map((item) => {
									const Icon = item.icon;
									const active = isSidebarNavActive(pathname, item.url);
									return (
										<Link
											key={item.url}
											href={item.url}
											onClick={() => setMobileOpen(false)}
											className={cn(
												"flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
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
