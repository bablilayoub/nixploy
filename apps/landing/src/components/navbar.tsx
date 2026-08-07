"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { navLinks, site } from "@/lib/site";
import { cn } from "@/lib/utils";

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
					? "border-b border-border/80 bg-background/85 backdrop-blur-xl"
					: "border-b border-transparent bg-transparent",
			)}
		>
			<nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
				<Logo />

				<div className="hidden items-center gap-1 text-sm text-muted md:flex">
					{navLinks.map((link) => {
						const active = pathname === link.href;
						return (
							<Link
								key={link.href}
								href={link.href}
								className={cn(
									"rounded-md px-3 py-1.5 transition-colors hover:text-foreground",
									active && "text-foreground",
								)}
							>
								{link.label}
							</Link>
						);
					})}
				</div>

				<div className="flex items-center gap-3">
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						className="hidden text-sm text-muted transition-colors hover:text-foreground sm:inline"
					>
						GitHub
					</a>
					<Link
						href="/install"
						className="hidden rounded-md bg-amber px-3.5 py-1.5 text-sm font-medium text-background transition-colors hover:bg-amber-soft sm:inline-flex"
					>
						Get started
					</Link>
					<button
						type="button"
						className="grid size-9 place-items-center rounded-md border border-border text-muted md:hidden"
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
						{navLinks.map((link) => (
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
					</div>
				</div>
			) : null}
		</header>
	);
}
