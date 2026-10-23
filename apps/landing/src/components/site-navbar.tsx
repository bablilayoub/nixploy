"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
	MobileNav,
	MobileNavHeader,
	MobileNavMenu,
	NavBody,
	Navbar,
	NavbarButton,
	NavItems,
} from "@/components/ui/resizable-navbar";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * Structure only: the bar itself is @aceternity/resizable-navbar, which is
 * flush at the top of the page and collapses into a floating island once the
 * page scrolls. Links, logo and actions are ours.
 */
const MENU_ID = "site-nav-menu";

const navItems = [
	{ name: "Docs", link: "/docs" },
	{ name: "Features", link: "/features" },
	{ name: "Templates", link: "/templates" },
	{ name: "Agents", link: "/agents" },
	{ name: "Pricing", link: "/pricing" },
];

/*
 * The section a path belongs to: `/docs/install` and `/templates/n8n` are
 * still Docs and Templates. `/api` is part of the docs section, which is where
 * its sidebar entry lives.
 */
function currentSection(pathname: string): string | null {
	if (pathname === "/api" || pathname.startsWith("/docs")) return "/docs";
	const match = navItems.find(
		(item) => pathname === item.link || pathname.startsWith(`${item.link}/`),
	);
	return match?.link ?? null;
}

export function SiteNavbar() {
	const [open, setOpen] = useState(false);
	const [scrolled, setScrolled] = useState(false);
	const pathname = usePathname();
	const navRef = useRef<HTMLDivElement>(null);

	/*
	 * The same 100px threshold the registry collapses at, tracked here as well
	 * because the bar needs different chrome in each state and `visible` is
	 * internal to `<Navbar>`: at the top a wide translucent pill that separates
	 * the nav from the page without being a black band across it, and once the
	 * page moves the narrow island the registry animates to.
	 */
	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 100);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	/*
	 * `aria-current` on the link for the section you are in. The registry's
	 * `NavItems` takes a flat list and renders the anchors itself, so there is
	 * no per-item prop to pass — this marks the one it rendered.
	 */
	useEffect(() => {
		const root = navRef.current;
		if (!root) return;
		const active = currentSection(pathname);
		for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
			const isCurrent = active !== null && link.getAttribute("href") === active;
			if (isCurrent) {
				link.setAttribute("aria-current", "page");
				link.dataset.current = "true";
			} else {
				link.removeAttribute("aria-current");
				delete link.dataset.current;
			}
		}
	}, [pathname]);

	return (
		// `fixed top-0`, not the registry's `sticky top-20`. Sticky keeps the bar
		// in the flow, which took a 66px band of flat page background out of the
		// top of every page — the hero's light then started under a hard
		// horizontal edge, which is the "black bar" this bar kept being. Fixed
		// lets the page run underneath it; every page's header already starts far
		// enough down to clear the pill.
		<>
			{/* Outside <Navbar> on purpose: it clones a `visible` prop onto each
			    of its children, and React warns when that lands on a DOM node. */}
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
			>
				Skip to content
			</a>
			<Navbar className="fixed top-0 pt-3">
				<NavBody
					className={cn(
						"border px-6 transition-colors duration-300",
						scrolled
							? "border-white/10"
							: "border-white/[0.07] bg-white/[0.03] backdrop-blur-md dark:bg-white/[0.03]",
					)}
				>
					<Logo className="relative z-20 mr-4" />
					<div ref={navRef} className="contents">
						<NavItems
							items={navItems}
							className="[&_a[data-current]]:font-medium [&_a[data-current]]:text-foreground"
						/>
					</div>
					<div className="relative z-20 flex items-center gap-2">
						{/* External: opens in its own tab, so the page you were reading
						    is still there when you come back. */}
						<NavbarButton href={site.github} variant="secondary" target="_blank" rel="noreferrer">
							GitHub
						</NavbarButton>
						<NavbarButton href="/docs/install" variant="primary">
							Install
						</NavbarButton>
					</div>
				</NavBody>

				<MobileNav>
					<MobileNavHeader>
						<Logo />
						{/* The registry's own toggle is a bare SVG with an onClick — not
						    focusable, no name, no state. This is a real button. */}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={open ? "Close the menu" : "Open the menu"}
							aria-expanded={open}
							aria-controls={MENU_ID}
							onClick={() => setOpen(!open)}
						>
							{open ? <X className="size-5" /> : <Menu className="size-5" />}
						</Button>
					</MobileNavHeader>
					<MobileNavMenu isOpen={open} onClose={() => setOpen(false)} className="dark:bg-card">
						<div id={MENU_ID} className="flex w-full flex-col">
							{navItems.map((item) => (
								<a
									key={item.link}
									href={item.link}
									onClick={() => setOpen(false)}
									className="flex min-h-11 w-full items-center text-muted-foreground transition-colors hover:text-foreground"
								>
									{item.name}
								</a>
							))}
						</div>
						<div className="flex w-full flex-col gap-2 pt-2">
							<NavbarButton
								href="/docs"
								variant="secondary"
								className="w-full rounded-lg border text-foreground"
							>
								Read the docs
							</NavbarButton>
							<NavbarButton href="/docs/install" variant="primary" className="w-full">
								Install Nixploy
							</NavbarButton>
						</div>
					</MobileNavMenu>
				</MobileNav>
			</Navbar>
		</>
	);
}
