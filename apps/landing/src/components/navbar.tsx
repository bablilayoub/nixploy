"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { GithubIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Pill } from "@/components/ui";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * A floating island, not a bar: a 56px pill of at most 1080px, sticky 16px
 * from the top, blurring what scrolls under it. Logo left, the six links in
 * the middle with the current one as a chip, the repository and the install
 * action on the right. Below lg the links fold into a panel under the island.
 */
const links = [
	{ name: "Docs", href: "/docs" },
	{ name: "Features", href: "/features" },
	{ name: "Templates", href: "/templates" },
	{ name: "Agents", href: "/agents" },
	{ name: "API", href: "/api" },
	{ name: "Pricing", href: "/pricing" },
] as const;

const MENU_ID = "mobile-nav-menu";

export function Navbar() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);

	// Close the mobile menu when the route changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the navigation signal
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<header className="sticky top-4 z-50 px-4 pt-4">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-small focus:font-semibold focus:text-background"
			>
				Skip to content
			</a>
			<div className="relative mx-auto max-w-[1080px]">
				<div className="flex h-14 items-center justify-between rounded-full border border-border bg-background/80 pr-2 pl-5 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.8)] backdrop-blur-md">
					<div className="flex items-center gap-6">
						<Logo />
						<nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
							{links.map((item) => {
								const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
								return (
									<Link
										key={item.href}
										href={item.href}
										aria-current={active ? "page" : undefined}
										className={cn(
											"inline-flex h-9 items-center rounded-full px-3.5 text-small font-medium transition-colors",
											active
												? "bg-surface-3 text-foreground"
												: "text-muted hover:bg-surface hover:text-foreground",
										)}
									>
										{item.name}
									</Link>
								);
							})}
						</nav>
					</div>
					<div className="hidden items-center gap-2 lg:flex">
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							aria-label="Nixploy on GitHub"
							className="inline-flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-foreground"
						>
							<GithubIcon className="size-4" aria-hidden />
						</a>
						<Pill href="/docs" variant="outline" size="sm">
							Read the docs
						</Pill>
						<Pill href="/docs/install" size="sm">
							Install Nixploy
						</Pill>
					</div>
					<button
						type="button"
						onClick={() => setOpen((value) => !value)}
						aria-label={open ? "Close menu" : "Open menu"}
						aria-expanded={open}
						aria-controls={open ? MENU_ID : undefined}
						className="inline-flex size-11 items-center justify-center rounded-full text-foreground lg:hidden"
					>
						{open ? <X className="size-5" /> : <Menu className="size-5" />}
					</button>
				</div>
				{open ? (
					<div
						id={MENU_ID}
						className="absolute inset-x-0 top-full mt-2 rounded-3xl border border-border bg-background/95 p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md lg:hidden"
					>
						{links.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className="flex min-h-11 items-center rounded-2xl px-3 text-body text-muted transition-colors hover:bg-surface hover:text-foreground"
							>
								{item.name}
							</Link>
						))}
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="flex min-h-11 items-center gap-2 rounded-2xl px-3 text-body text-muted transition-colors hover:bg-surface hover:text-foreground"
						>
							<GithubIcon className="size-4" aria-hidden />
							GitHub
						</a>
						<Pill href="/docs/install" className="mt-2 w-full">
							Install Nixploy
						</Pill>
					</div>
				) : null}
			</div>
		</header>
	);
}
