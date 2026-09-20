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
 * Two states, one bar. At the top of the page it is flush: a full-bleed
 * 56px header with a hairline under it, nothing floating, the page starting
 * exactly beneath. Past the first few pixels of scroll it becomes the island
 * — a 1080px pill that drops 12px clear of the top edge, takes a border, a
 * shadow and a blur, while the full-bleed backdrop fades away behind it.
 *
 * The header keeps a constant 56px box in flow and the island moves with a
 * transform, so the morph cannot shift the page under it. The two
 * backgrounds cross-fade rather than one animating its width, because a
 * max-width interpolating from a percentage to a pixel value stalls until
 * the viewport is narrower than the target and reads as a stutter.
 *
 * Logo left, the six links in the middle with the current one as a chip, the
 * repository and the install action on the right. Below lg the links fold
 * into a panel under the island.
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

/** Past this many pixels the bar becomes the island. */
const SCROLL_THRESHOLD = 8;

/**
 * Has the page scrolled off the top? Reads once on mount as well, since a
 * page opened at an anchor (or restored by the browser) starts scrolled and
 * would otherwise paint the flush bar over content it no longer touches.
 * Coalesced into an animation frame: the listener fires per scroll event and
 * only the boolean matters.
 */
function useScrolled(threshold = SCROLL_THRESHOLD): boolean {
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		let frame = 0;
		const read = () => {
			frame = 0;
			setScrolled(window.scrollY > threshold);
		};
		const onScroll = () => {
			if (frame) return;
			frame = requestAnimationFrame(read);
		};
		read();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [threshold]);

	return scrolled;
}

export function Navbar() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const scrolled = useScrolled();

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
		<header className="sticky top-0 z-50 h-14">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-small focus:font-semibold focus:text-background"
			>
				Skip to content
			</a>
			{/* The flush bar's own background, full-bleed, fading out as the
			    island takes over. */}
			<div
				aria-hidden
				className={cn(
					"absolute inset-x-0 top-0 h-14 border-b border-border bg-background/80 backdrop-blur-md transition-opacity duration-300 ease-out motion-reduce:transition-none",
					scrolled ? "opacity-0" : "opacity-100",
				)}
			/>
			{/* The gutter lives outside the positioning context on purpose: the
			    mobile panel is `inset-x-0` against it, so padding here would put
			    the panel edge to edge on a phone. */}
			<div className="h-14 px-4">
				<div
					className={cn(
						"relative mx-auto h-14 max-w-[1080px] transition-transform duration-300 ease-out motion-reduce:transition-none",
						scrolled && "translate-y-3",
					)}
				>
					<div
						className={cn(
							"flex h-14 items-center justify-between border pr-2 pl-5 transition-[background-color,border-color,border-radius,box-shadow] duration-300 ease-out motion-reduce:transition-none",
							scrolled
								? "rounded-full border-border bg-background/80 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.8)] backdrop-blur-md"
								: "rounded-none border-transparent bg-transparent shadow-none",
						)}
					>
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
			</div>
		</header>
	);
}
