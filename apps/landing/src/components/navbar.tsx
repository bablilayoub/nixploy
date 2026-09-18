"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { GithubIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const links = [
	{ href: "/features", label: "Features" },
	{ href: "/templates", label: "Templates" },
	{ href: "/agents", label: "Agents" },
	{ href: "/compare", label: "Compare" },
	{ href: "/docs", label: "Docs" },
	{ href: "/api", label: "API" },
	{ href: "/pricing", label: "Pricing" },
] as const;

export function Navbar() {
	const pathname = usePathname();
	const [scrolled, setScrolled] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	// Close the mobile menu when the route changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the navigation signal
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-50 transition-[background,border-color] duration-300",
				scrolled || open
					? "border-b border-border bg-background/80 backdrop-blur-xl"
					: "border-b border-transparent bg-transparent",
			)}
		>
			<nav className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-6">
				<Logo />

				<div className="hidden items-center gap-1 text-sm text-muted md:flex">
					{links.map((link) => {
						const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
						return (
							<Link
								key={link.href}
								href={link.href}
								className={cn(
									"rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground",
									active && "text-foreground",
								)}
							>
								{link.label}
							</Link>
						);
					})}
				</div>

				<div className="flex items-center justify-end gap-2">
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						aria-label="GitHub repository"
						className="hidden size-9 place-items-center rounded-full border border-border text-muted transition-colors hover:border-border-strong hover:text-foreground sm:grid"
					>
						<GithubIcon className="size-4" />
					</a>
					<Link
						href="/docs/install"
						className="hidden h-9 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 sm:inline-flex"
					>
						Install
					</Link>
					<button
						type="button"
						className="grid size-9 place-items-center rounded-full border border-border text-muted md:hidden"
						aria-label={open ? "Close menu" : "Open menu"}
						onClick={() => setOpen((value) => !value)}
					>
						{open ? <X className="size-4" /> : <Menu className="size-4" />}
					</button>
				</div>
			</nav>

			{open ? (
				<div className="border-t border-border bg-background/95 px-5 py-4 md:hidden">
					<div className="flex flex-col gap-1">
						{links.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="rounded-md px-2 py-2.5 text-sm text-muted hover:text-foreground"
							>
								{link.label}
							</Link>
						))}
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="rounded-md px-2 py-2.5 text-sm text-muted hover:text-foreground"
						>
							GitHub
						</a>
						<Link
							href="/docs/install"
							className="mt-2 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-3.5 text-sm font-medium text-background"
						>
							Install Nixploy
						</Link>
					</div>
				</div>
			) : null}
		</header>
	);
}
