import Link from "next/link";
import type { ReactNode } from "react";

import { Cta } from "@/components/sections/cta";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";
import { Separator } from "@/components/ui/separator";
import { docsNav } from "@/lib/docs/nav";
import { cn } from "@/lib/utils";

/*
 * The docs layout: the group list on the left, the article on the right.
 * Structure only; the pieces are shadcn primitives.
 */
function NavList({ activeHref }: { activeHref: string }) {
	return (
		<div className="flex flex-col gap-7">
			{docsNav.map((group) => (
				<div key={group.title}>
					<p className="px-3 text-xs font-semibold tracking-wide text-foreground uppercase">
						{group.title}
					</p>
					<ul className="mt-2 flex flex-col">
						{group.items.map((item) => {
							const active = activeHref === item.href || (item.index && activeHref === "/docs");
							return (
								<li key={item.href}>
									<Link
										href={item.href}
										aria-current={active ? "page" : undefined}
										className={cn(
											"flex min-h-9 items-center rounded-md px-3 text-sm transition-colors",
											active
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
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

export function DocsFrame({ children, activeHref }: { children: ReactNode; activeHref: string }) {
	return (
		<div className="relative min-h-screen">
			<SiteNavbar />
			<main
				id="main-content"
				className="container-page pt-20 pb-20 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14 lg:pt-24"
			>
				<aside className="hidden lg:block">
					<nav aria-label="Documentation" className="sticky top-24 -ml-3">
						<NavList activeHref={activeHref} />
					</nav>
				</aside>
				<details className="mb-8 rounded-xl border lg:hidden">
					<summary className="cursor-pointer px-4 py-3 text-sm font-medium">All docs</summary>
					<div className="px-2 pt-2 pb-4">
						<Separator className="mb-4" />
						<NavList activeHref={activeHref} />
					</div>
				</details>
				<div className="min-w-0 max-w-3xl">{children}</div>
			</main>
			<Cta />
			<SiteFooter />
		</div>
	);
}
