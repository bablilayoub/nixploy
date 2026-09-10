import Link from "next/link";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { docsNav } from "@/lib/docs/nav";
import { cn } from "@/lib/utils";

export function DocsShell({
	children,
	activeHref,
}: {
	children: React.ReactNode;
	activeHref: string;
}) {
	return (
		<div className="relative flex min-h-screen flex-col bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<Navbar />
			<div className="relative mx-auto flex w-full max-w-6xl flex-1 gap-10 px-5 pt-28 pb-20 sm:px-6 sm:pt-32">
				<aside className="hidden w-56 shrink-0 md:block">
					<nav className="sticky top-28 space-y-6" aria-label="Documentation">
						{docsNav.map((group) => (
							<div key={group.title}>
								<p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-muted uppercase">
									{group.title}
								</p>
								<ul className="space-y-0.5">
									{group.items.map((item) => {
										const active =
											activeHref === item.href || (item.index && activeHref === "/docs");
										return (
											<li key={item.href}>
												<Link
													href={item.href}
													className={cn(
														"block rounded-md px-2.5 py-1.5 text-sm transition-colors",
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
					</nav>
				</aside>
				<main className="min-w-0 flex-1">{children}</main>
			</div>
			{/* Mobile doc nav */}
			<div className="border-t border-border md:hidden">
				<details className="mx-auto max-w-6xl px-5 py-4">
					<summary className="cursor-pointer eyebrow">Docs menu</summary>
					<nav className="mt-4 grid gap-4" aria-label="Documentation mobile">
						{docsNav.map((group) => (
							<div key={group.title}>
								<p className="mb-1 text-xs font-medium text-foreground">{group.title}</p>
								<ul className="space-y-1">
									{group.items.map((item) => (
										<li key={item.href}>
											<Link href={item.href} className="text-sm text-muted hover:text-foreground">
												{item.label}
											</Link>
										</li>
									))}
								</ul>
							</div>
						))}
					</nav>
				</details>
			</div>
			<Footer />
		</div>
	);
}
