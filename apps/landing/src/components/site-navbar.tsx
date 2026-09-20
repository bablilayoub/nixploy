"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
	MobileNav,
	MobileNavHeader,
	MobileNavMenu,
	MobileNavToggle,
	NavBody,
	Navbar,
	NavbarButton,
	NavItems,
} from "@/components/ui/resizable-navbar";
import { site } from "@/lib/site";

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

export function SiteNavbar() {
	const [open, setOpen] = useState(false);

	return (
		// `top-0`: the registry component ships `sticky top-20`, which pins the bar
		// 80px down the viewport from the first paint and leaves a black band
		// above it on every page. The floating state adds its own 20px offset.
		<>
			{/* Outside <Navbar> on purpose: it clones a `visible` prop onto each
			    of its children, and React warns when that lands on a DOM node. */}
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
			>
				Skip to content
			</a>
			<Navbar className="top-0">
				<NavBody className="px-6">
					<Logo className="relative z-20 mr-4" />
					<NavItems items={navItems} />
					<div className="relative z-20 flex items-center gap-2">
						<NavbarButton href={site.github} variant="secondary">
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
						{navItems.map((item) => (
							<a
								key={item.link}
								href={item.link}
								onClick={() => setOpen(false)}
								className="w-full py-2 text-neutral-300"
							>
								{item.name}
							</a>
						))}
						<div className="flex w-full flex-col gap-2 pt-2">
							<NavbarButton href="/docs" variant="secondary" className="w-full">
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
