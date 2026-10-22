import Link from "next/link";
import type { ReactNode } from "react";

import { Reveal } from "@/components/motion-provider";
import { Cta } from "@/components/sections/cta";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";
import { cn } from "@/lib/utils";

/** An inline link in running text. */
export function ProseLink({ href, children }: { href: string; children: ReactNode }) {
	const external = href.startsWith("http");
	const className = "text-primary underline underline-offset-4 hover:decoration-2";
	if (external) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={className}>
				{children}
			</a>
		);
	}
	return (
		<Link href={href} className={className}>
			{children}
		</Link>
	);
}

/*
 * Every page that is not the home page: the same navigation, a clear neutral
 * header, the page's own blocks, the shared close and
 * the footer. Structure only — the parts are registry components.
 */
export function PageFrame({
	children,
	eyebrow,
	title,
	description,
	actions,
	mark,
	width = "full",
	close = true,
}: {
	children: ReactNode;
	eyebrow?: string;
	title?: string;
	description?: ReactNode;
	actions?: ReactNode;
	/** A leading mark above the eyebrow — a template's own logo, say. */
	mark?: ReactNode;
	width?: "full" | "prose";
	close?: boolean;
}) {
	return (
		<div className="signal-page relative min-h-screen">
			<SiteNavbar />
			<main id="main-content" className="relative">
				{title ? (
					<header className="signal-page-hero">
						<Reveal
							className={cn("container-page relative z-10", width === "prose" && "max-w-3xl")}
						>
							{mark ? (
								<span className="mb-5 inline-flex size-14 items-center justify-center rounded-xl border bg-card">
									{mark}
								</span>
							) : null}
							{eyebrow ? <p className="signal-kicker">{eyebrow}</p> : null}
							<h1 className="mt-4 max-w-5xl text-4xl leading-[1.08] font-medium tracking-[-0.045em] text-balance sm:text-5xl lg:text-6xl">
								{title}
							</h1>
							{description ? (
								<p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
									{description}
								</p>
							) : null}
							{actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
						</Reveal>
					</header>
				) : null}
				<div
					className={cn(
						"signal-page-body container-page",
						width === "prose" && "max-w-3xl",
						title ? "pt-12" : "pt-24 lg:pt-28",
					)}
				>
					<div className="min-w-0">{children}</div>
				</div>
			</main>
			{close ? <Cta /> : null}
			<SiteFooter />
		</div>
	);
}
