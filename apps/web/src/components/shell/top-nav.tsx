"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { CommandPalette } from "@/components/command-palette";
import { ModeToggle } from "@/components/mode-toggle";
import { mainNavItems, NavMain } from "@/components/nav-projects";
import { OrgSwitcher } from "@/components/org-switcher";
import { Logo, LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";

/** Dashboard shell top navigation: logo, org switcher, pill nav, utilities. */
export function TopNav() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
			<div className="flex h-14 items-center gap-3 px-4 md:px-6">
				{/* Mobile: hamburger menu */}
				<Sheet>
					<SheetTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							className="md:hidden"
							aria-label="Open navigation"
						>
							<Menu className="size-4" />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" className="w-72 gap-6 p-6">
						<SheetHeader className="p-0">
							<SheetTitle asChild>
								<Link href="/dashboard">
									<Logo />
								</Link>
							</SheetTitle>
						</SheetHeader>
						<nav className="flex flex-col gap-1">
							{mainNavItems.map((item) => (
								<Link
									key={item.href}
									href={item.href}
									className="rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
								>
									{item.label}
								</Link>
							))}
						</nav>
					</SheetContent>
				</Sheet>

				<Link
					href="/dashboard"
					className="mr-1 flex items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					aria-label="Nixploy dashboard"
				>
					<LogoMark className="size-5" />
				</Link>
				<OrgSwitcher />

				<NavMain className="ml-4 hidden md:flex" />

				<div className="ml-auto flex items-center gap-2">
					<CommandPalette />
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
