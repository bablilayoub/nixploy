"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ScrollProgress } from "@/components/magicui/scroll-progress";
import { navLinks, site } from "@/lib/site";

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

	return (
		<>
			<ScrollProgress className="bg-gradient-to-r from-white via-neutral-400 to-white" />
			<header
				className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
					scrolled || open
						? "border-b border-white/10 bg-black/70 backdrop-blur-xl"
						: "border-b border-transparent bg-transparent"
				}`}
			>
				<nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
					<Link href="/" className="text-lg font-semibold tracking-tight text-white">
						{site.name}
					</Link>

					<div className="hidden items-center gap-1 text-sm text-neutral-400 md:flex">
						{navLinks.map((link) => {
							const active = pathname === link.href;
							return (
								<Link
									key={link.href}
									href={link.href}
									className={`px-3 py-1.5 transition-colors hover:text-white ${active ? "text-white" : ""}`}
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
							className="hidden text-sm text-neutral-400 transition-colors hover:text-white sm:inline"
						>
							GitHub
						</a>
						<Link
							href="/install"
							className="hidden border border-white/20 bg-white px-3.5 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 sm:inline-flex"
						>
							Install
						</Link>
						<button
							type="button"
							className="grid size-9 place-items-center border border-white/15 text-neutral-300 md:hidden"
							aria-label={open ? "Close menu" : "Open menu"}
							onClick={() => setOpen((v) => !v)}
						>
							{open ? <X className="size-4" /> : <Menu className="size-4" />}
						</button>
					</div>
				</nav>

				{open && (
					<div className="border-t border-white/10 bg-black/95 px-5 py-4 md:hidden">
						<div className="flex flex-col gap-1">
							{navLinks.map((link) => (
								<Link
									key={link.href}
									href={link.href}
									onClick={() => setOpen(false)}
									className="px-2 py-2.5 text-sm text-neutral-300 hover:text-white"
								>
									{link.label}
								</Link>
							))}
							<a
								href={site.github}
								target="_blank"
								rel="noreferrer"
								onClick={() => setOpen(false)}
								className="px-2 py-2.5 text-sm text-neutral-300"
							>
								GitHub
							</a>
						</div>
					</div>
				)}
			</header>
		</>
	);
}
