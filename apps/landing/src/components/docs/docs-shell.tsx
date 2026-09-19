import Link from "next/link";
import type { ReactNode } from "react";

import { Footer } from "@/components/footer";
import { Cta } from "@/components/home/cta";
import { Navbar } from "@/components/navbar";
import { Container } from "@/components/ui";
import { docsNav } from "@/lib/docs/nav";
import { cn } from "@/lib/utils";

/*
 * The docs layout: a sticky group list on the left, a 48rem reading column
 * on the right, inside the same 1280px column as every other page. Below lg
 * the group list folds into a disclosure above the article. Ends on the
 * closing glow like every page.
 */
function NavList({ activeHref, compact = false }: { activeHref: string; compact?: boolean }) {
	return (
		<div className={cn("flex flex-col", compact ? "gap-6" : "gap-8")}>
			{docsNav.map((group) => (
				<div key={group.title}>
					<p className="px-3 text-small font-semibold text-foreground">{group.title}</p>
					<ul className="mt-2 flex flex-col">
						{group.items.map((item) => {
							const active = activeHref === item.href || (item.index && activeHref === "/docs");
							return (
								<li key={item.href}>
									<Link
										href={item.href}
										aria-current={active ? "page" : undefined}
										className={cn(
											"flex items-center rounded-lg px-3 text-small transition-colors",
											compact ? "min-h-11" : "py-1.5",
											active
												? "bg-surface text-foreground"
												: "text-muted hover:bg-surface/60 hover:text-foreground",
										)}
									>
										{item.label}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}

export function DocsShell({ children, activeHref }: { children: ReactNode; activeHref: string }) {
	return (
		<div className="relative flex min-h-screen flex-col">
			<Navbar />
			<main id="main-content" className="relative flex-1 pb-24 lg:pb-32">
				<Container className="pt-10 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16 lg:pt-16">
					<aside className="hidden lg:block">
						<nav aria-label="Documentation" className="sticky top-24 -ml-3">
							<NavList activeHref={activeHref} />
						</nav>
					</aside>
					<details className="mb-8 rounded-2xl border border-border bg-background lg:hidden">
						<summary className="cursor-pointer px-5 py-3.5 text-small font-medium text-foreground">
							All docs
						</summary>
						<nav aria-label="Documentation" className="border-t border-border px-2 py-4">
							<NavList activeHref={activeHref} compact />
						</nav>
					</details>
					<div className="min-w-0 max-w-[48rem]">{children}</div>
				</Container>
			</main>
			<Cta compact />
			<Footer />
		</div>
	);
}
