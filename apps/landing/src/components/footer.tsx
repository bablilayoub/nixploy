import Link from "next/link";

import { LogoMark } from "@/components/logo";
import { site } from "@/lib/site";

const links = [
	{ href: site.github, label: "GitHub" },
	{ href: "/docs", label: "Docs" },
	{ href: "/templates", label: "Templates" },
	{ href: "/pricing", label: "Pricing" },
	{ href: "/api", label: "API" },
	{ href: `${site.github}/blob/main/LICENSE`, label: "Licence" },
	{ href: "/privacy", label: "Privacy" },
];

export function Footer() {
	return (
		<footer className="border-t border-border">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
				<div className="flex items-center gap-2.5">
					<LogoMark className="size-6" />
					<span className="text-[15px] font-semibold tracking-tight">{site.name}</span>
					<span className="ml-2 text-[13px] text-muted-2">Apache-2.0</span>
				</div>

				<nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px]">
					{links.map((link) =>
						link.href.startsWith("http") ? (
							<a
								key={link.href}
								href={link.href}
								target="_blank"
								rel="noreferrer"
								className="text-muted transition-colors hover:text-foreground"
							>
								{link.label}
							</a>
						) : (
							<Link
								key={link.href}
								href={link.href}
								className="text-muted transition-colors hover:text-foreground"
							>
								{link.label}
							</Link>
						),
					)}
				</nav>
			</div>
		</footer>
	);
}
