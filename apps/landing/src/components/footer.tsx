import Link from "next/link";

import { LogoMark } from "@/components/logo";
import { footerLinks, site } from "@/lib/site";

const columns = [
	{
		title: "Product",
		links: [
			{ href: "/features", label: "Features" },
			{ href: "/features#templates", label: "Templates" },
			{ href: "/pricing", label: "Pricing" },
			{ href: "/docs/install", label: "Install" },
		],
	},
	{
		title: "Developers",
		links: [
			{ href: "/docs", label: "Docs" },
			{ href: "/api", label: "API reference" },
			{ href: "/docs/mcp", label: "MCP server" },
			{ href: site.github, label: "GitHub" },
		],
	},
	{
		title: "Company",
		links: [
			{ href: "/about", label: "About" },
			{ href: "/privacy", label: "Privacy" },
			{ href: `mailto:${site.email}`, label: site.email },
		],
	},
];

export function Footer() {
	return (
		<footer className="border-t border-border bg-surface/30">
			<div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
				<div className="space-y-3">
					<div className="flex items-center gap-2.5">
						<LogoMark className="size-8" />
						<p className="font-display text-lg font-semibold tracking-tight">{site.name}</p>
					</div>
					<p className="max-w-xs text-sm text-muted">{site.tagline}</p>
					<p className="text-xs text-muted-2">
						© {new Date().getFullYear()} Nixploy. Open source under Apache-2.0.
					</p>
				</div>
				{columns.map((column) => (
					<div key={column.title}>
						<p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-muted-2 uppercase">
							{column.title}
						</p>
						<ul className="space-y-2 text-sm">
							{column.links.map((link) =>
								link.href.startsWith("http") || link.href.startsWith("mailto:") ? (
									<li key={link.href}>
										<a
											href={link.href}
											target={link.href.startsWith("http") ? "_blank" : undefined}
											rel="noreferrer"
											className="text-muted transition-colors hover:text-foreground"
										>
											{link.label}
										</a>
									</li>
								) : (
									<li key={link.href}>
										<Link
											href={link.href}
											className="text-muted transition-colors hover:text-foreground"
										>
											{link.label}
										</Link>
									</li>
								),
							)}
						</ul>
					</div>
				))}
			</div>
			<div className="border-t border-border">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-xs text-muted-2 sm:px-6">
					{footerLinks.map((link) => (
						<Link key={link.href} href={link.href} className="hover:text-foreground">
							{link.label}
						</Link>
					))}
					<span className="ml-auto">Docker Swarm · Traefik v3 · PostgreSQL</span>
				</div>
			</div>
		</footer>
	);
}
