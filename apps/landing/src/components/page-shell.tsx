import Link from "next/link";
import type { ReactNode } from "react";

import { Footer } from "@/components/footer";
import { Cta } from "@/components/home/cta";
import { Navbar } from "@/components/navbar";
import { Container, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/** An inline link in running text: the accent, underlined on hover. */
export function ProseLink({ href, children }: { href: string; children: ReactNode }) {
	const external = href.startsWith("http");
	const className =
		"text-accent-strong underline decoration-transparent underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40";
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
 * Every page that is not the home page: the nav, a centred header in the
 * reference's product-page style (or a left-aligned one for reading pages),
 * the page's own blocks, then the same closing glow the home page ends on and
 * the footer. `width` picks the column: the full 1280px, or a 42rem reading
 * column for prose.
 */
export function PageShell({
	children,
	eyebrow,
	title,
	description,
	icon,
	actions,
	align = "center",
	size = "display",
	width = "full",
	close = true,
	className,
}: {
	children: ReactNode;
	eyebrow?: string;
	title?: string;
	description?: ReactNode;
	icon?: ReactNode;
	actions?: ReactNode;
	align?: "center" | "left";
	size?: "display" | "headline";
	width?: "full" | "prose";
	/** The closing card. Off for pages that end on their own action. */
	close?: boolean;
	className?: string;
}) {
	return (
		<div className="relative flex min-h-screen flex-col">
			<Navbar />
			<main id="main-content" className="relative flex-1 pb-24 lg:pb-32">
				<Container className={cn(width === "prose" && "max-w-[42rem]", className)}>
					{title ? (
						<PageHeader
							eyebrow={eyebrow}
							title={title}
							description={description}
							icon={icon}
							actions={actions}
							align={align}
							size={size}
						/>
					) : null}
					<div className={title ? "mt-14 lg:mt-20" : "pt-16 lg:pt-24"}>{children}</div>
				</Container>
			</main>
			{close ? <Cta compact /> : null}
			<Footer />
		</div>
	);
}
