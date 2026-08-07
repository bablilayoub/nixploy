import Link from "next/link";

import { LogoMark } from "@/components/logo";
import { footerLinks, site } from "@/lib/site";

export function Footer() {
	return (
		<footer className="border-t border-border">
			<div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-12 sm:flex-row sm:items-end sm:justify-between sm:px-6">
				<div className="space-y-3">
					<div className="flex items-center gap-2.5">
						<LogoMark className="size-8" />
						<p className="font-display text-lg font-semibold tracking-tight">{site.name}</p>
					</div>
					<p className="max-w-sm text-sm text-muted">{site.tagline}</p>
					<p className="text-xs text-muted/70">
						© {new Date().getFullYear()} Nixploy. Open source under Apache-2.0.
					</p>
				</div>
				<nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
					{footerLinks.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="transition-colors hover:text-foreground"
						>
							{link.label}
						</Link>
					))}
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						className="transition-colors hover:text-foreground"
					>
						GitHub
					</a>
				</nav>
			</div>
		</footer>
	);
}
