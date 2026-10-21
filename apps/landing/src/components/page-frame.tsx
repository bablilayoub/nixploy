import Link from "next/link";
import type { ReactNode } from "react";

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
 * Every page that is not the home page: the same bar, a header on a dotted
 * field (@magicui/dot-pattern), the page's own blocks, the shared close and
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
		<div className="relative min-h-screen">
			<SiteNavbar />
			<main id="main-content" className="relative">
				{title ? (
					<header className="relative border-b bg-card pt-32 pb-12 lg:pt-40 lg:pb-16">
						<div className={cn("container-page relative", width === "prose" && "max-w-3xl")}>
							{mark ? (
								<span className="mb-5 inline-flex size-14 items-center justify-center rounded-xl border bg-card">
									{mark}
								</span>
							) : null}
							{eyebrow ? (
								<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
									{eyebrow}
								</p>
							) : null}
							<h1 className="mt-4 max-w-3xl text-4xl leading-[1.05] font-semibold tracking-[-0.05em] text-balance sm:text-5xl lg:text-6xl">
								{title}
							</h1>
							{description ? (
								<p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
									{description}
								</p>
							) : null}
							{actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
						</div>
					</header>
				) : null}
				<div
					className={cn(
						"container-page pb-16",
						width === "prose" && "max-w-3xl",
						title ? "pt-12" : "pt-24 lg:pt-28",
					)}
				>
					{children}
				</div>
			</main>
			{close ? <Cta /> : null}
			<SiteFooter />
		</div>
	);
}
