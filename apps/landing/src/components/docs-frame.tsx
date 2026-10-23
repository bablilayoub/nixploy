import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Cta } from "@/components/sections/cta";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";
import { Separator } from "@/components/ui/separator";
import type { DocHeading } from "@/lib/docs/headings";
import { docPager, docsNav } from "@/lib/docs/nav";
import { cn } from "@/lib/utils";

/*
 * The docs layout: the group list on the left, the article in the middle, and
 * — from xl up, where there is room for it — the page's own headings on the
 * right. Under the article, the previous and next page in the sidebar's
 * order, so reading straight through never needs the sidebar.
 *
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

function Pager({ activeHref }: { activeHref: string }) {
	const { prev, next } = docPager(activeHref);
	if (!prev && !next) return null;
	return (
		<nav aria-label="Pagination" className="mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2">
			{prev ? (
				<Link
					href={prev.href}
					className="group flex flex-col gap-1 rounded-xl border p-4 transition-colors hover:border-foreground/25"
				>
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
						Previous
					</span>
					<span className="font-medium">{prev.label}</span>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link
					href={next.href}
					className="group flex flex-col items-end gap-1 rounded-xl border p-4 text-right transition-colors hover:border-foreground/25 sm:col-start-2"
				>
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						Next
						<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
					</span>
					<span className="font-medium">{next.label}</span>
				</Link>
			) : null}
		</nav>
	);
}

export function DocsFrame({
	children,
	activeHref,
	headings = [],
}: {
	children: ReactNode;
	activeHref: string;
	/** The article's own `h2`s, for the right-hand rail. */
	headings?: DocHeading[];
}) {
	return (
		<div className="relative min-h-screen">
			<SiteNavbar />
			<main
				id="main-content"
				className="container-page pt-20 pb-20 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14 lg:pt-24 xl:grid-cols-[240px_minmax(0,1fr)_200px] xl:gap-12"
			>
				<aside className="hidden lg:block">
					<nav
						aria-label="Documentation"
						className="sticky top-24 -ml-3 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-8"
					>
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

				<div className="min-w-0">
					{children}
					<Pager activeHref={activeHref} />
				</div>

				{headings.length > 1 ? (
					<aside className="hidden xl:block">
						<nav aria-label="On this page" className="sticky top-24">
							<p className="text-xs font-semibold tracking-wide text-foreground uppercase">
								On this page
							</p>
							<ul className="mt-3 flex flex-col border-l">
								{headings.map((heading) => (
									<li key={heading.id}>
										<a
											href={`#${heading.id}`}
											className="-ml-px flex min-h-9 items-center border-l border-transparent py-1 pl-3 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
										>
											{heading.text}
										</a>
									</li>
								))}
							</ul>
						</nav>
					</aside>
				) : null}
			</main>
			<Cta />
			<SiteFooter />
		</div>
	);
}
