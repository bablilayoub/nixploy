"use client";

import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { DocsSearch } from "@/components/docs-search";
import { Logo } from "@/components/logo";
import { MotionToggle } from "@/components/motion-provider";
import { ThemeToggle } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { site } from "@/lib/site";

const links = [
	{ label: "Product", href: "/features" },
	{ label: "Templates", href: "/templates" },
	{ label: "Documentation", href: "/docs" },
	{ label: "For agents", href: "/agents" },
	{ label: "Pricing", href: "/pricing" },
];
export function SiteNavbar() {
	const pathname = usePathname();
	const active = (href: string) =>
		pathname === href ||
		pathname.startsWith(`${href}/`) ||
		(href === "/docs" && pathname === "/api");
	return (
		<>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
			>
				Skip to content
			</a>
			<header className="site-topbar fixed inset-x-0 top-0 z-40 border-b bg-background">
				<div className="container-page flex min-h-18 items-center gap-4">
					<Logo />
					<NavigationMenu aria-label="Main navigation" className="hidden lg:flex">
						<NavigationMenuList>
							{links.map(({ label, href }) => (
								<NavigationMenuItem key={href}>
									<NavigationMenuLink
										asChild
										active={active(href)}
										className={navigationMenuTriggerStyle()}
									>
										<Link href={href} aria-current={active(href) ? "page" : undefined}>
											{label}
										</Link>
									</NavigationMenuLink>
								</NavigationMenuItem>
							))}
						</NavigationMenuList>
					</NavigationMenu>
					<div className="ms-auto flex items-center gap-2">
						<DocsSearch />
						<span className="hidden sm:inline-flex">
							<MotionToggle />
						</span>
						<ThemeToggle />
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="hidden min-h-11 items-center gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground sm:inline-flex"
						>
							GitHub
							<GitHubLogoIcon aria-hidden="true" className="size-3.5" />
						</a>
						<Button asChild className="hidden h-10 rounded-md xl:inline-flex">
							<Link href="/docs/install">Install Nixploy</Link>
						</Button>
						<Dialog.Root>
							<Dialog.Trigger
								aria-label="Open navigation"
								className="flex size-11 items-center justify-center rounded-md border lg:hidden"
							>
								<Menu className="size-5" />
							</Dialog.Trigger>
							<Dialog.Portal>
								<Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
								<Dialog.Content
									role="dialog"
									aria-modal="true"
									className="fixed inset-x-3 top-3 z-50 max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border bg-popover p-5 shadow-[var(--overlay-shadow)]"
								>
									<div className="mb-8 flex items-center justify-between">
										<Dialog.Title className="text-base font-semibold">Explore Nixploy</Dialog.Title>
										<Dialog.Close
											aria-label="Close navigation"
											className="flex size-11 items-center justify-center rounded-md hover:bg-accent"
										>
											<X className="size-5" />
										</Dialog.Close>
									</div>
									<Dialog.Description className="sr-only">
										Product, documentation, and installation links.
									</Dialog.Description>
									<nav aria-label="Mobile navigation" className="flex flex-col divide-y">
										{links.map(({ label, href }) => (
											<Dialog.Close asChild key={href}>
												<Link
													href={href}
													aria-current={active(href) ? "page" : undefined}
													className="flex min-h-14 items-center justify-between text-lg font-medium"
												>
													{label}
													<ArrowUpRight className="size-4 text-muted-foreground" />
												</Link>
											</Dialog.Close>
										))}
									</nav>
									<MotionToggle label />
									<Dialog.Close asChild>
										<Button asChild className="mt-8 h-12 w-full">
											<Link href="/docs/install">Install Nixploy</Link>
										</Button>
									</Dialog.Close>
								</Dialog.Content>
							</Dialog.Portal>
						</Dialog.Root>
					</div>
				</div>
			</header>
		</>
	);
}
