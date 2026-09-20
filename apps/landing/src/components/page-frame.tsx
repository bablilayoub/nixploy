import Link from "next/link";
import type { ReactNode } from "react";

import { Cta } from "@/components/sections/cta";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";
import { DotPattern } from "@/components/ui/dot-pattern";
import { cn } from "@/lib/utils";

/** An inline link in running text. */
export function ProseLink({ href, children }: { href: string; children: ReactNode }) {
	const external = href.startsWith("http");
	const className = "text-primary underline-offset-4 hover:underline";
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
	width = "full",
	close = true,
}: {
	children: ReactNode;
	eyebrow?: string;
	title?: string;
	description?: ReactNode;
	actions?: ReactNode;
	width?: "full" | "prose";
	close?: boolean;
}) {
	return (
		<div className="relative min-h-screen">
			<SiteNavbar />
			<main id="main-content" className="relative">
				{title ? (
					<header className="relative overflow-hidden px-6 pt-24 pb-10 lg:pt-28">
						<DotPattern
							width={28}
							height={28}
							className="[mask-image:radial-gradient(520px_circle_at_50%_0%,white,transparent)] opacity-50"
						/>
						<div className="relative mx-auto max-w-7xl">
							{eyebrow ? (
								<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
									{eyebrow}
								</p>
							) : null}
							<h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance lg:text-6xl">
								{title}
							</h1>
							{description ? (
								<p className="mt-5 max-w-2xl text-lg text-muted-foreground">{description}</p>
							) : null}
							{actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
						</div>
					</header>
				) : null}
				<div
					className={cn(
						"mx-auto px-6 pb-16",
						width === "prose" ? "max-w-3xl" : "max-w-7xl",
						title ? "pt-8" : "pt-24 lg:pt-28",
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
