"use client";

import { useState } from "react";

import { Logo } from "@/components/logo";
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
		<Navbar className="top-0">
			<NavBody>
				<Logo className="relative z-20 mr-4 px-2" />
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
					<Logo className="px-2" />
					<MobileNavToggle isOpen={open} onClick={() => setOpen(!open)} />
				</MobileNavHeader>
				<MobileNavMenu isOpen={open} onClose={() => setOpen(false)}>
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
	);
}
