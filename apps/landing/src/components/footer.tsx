import Link from "next/link";

import { GithubIcon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { Container, Eyebrow, Pill } from "@/components/ui";
import { site } from "@/lib/site";

/*
 * A hairline, then the mark with one line and one pill where a newsletter box
 * would be (the install command itself is in the closing card, once), three
 * columns of plain links, and a bottom line with the licence and the
 * repository. Sub-pages render the same footer.
 */
const columns = [
	{
		heading: "Product",
		links: [
			{ href: "/features", label: "Features" },
			{ href: "/templates", label: "Templates" },
			{ href: "/pricing", label: "Pricing" },
			{ href: "/compare", label: "Compare" },
		],
	},
	{
		heading: "Developers",
		links: [
			{ href: "/docs", label: "Documentation" },
			{ href: "/docs/cli", label: "CLI" },
			{ href: "/api", label: "REST API" },
			{ href: "/agents", label: "MCP and agents" },
		],
	},
	{
		heading: "Project",
		links: [
			{ href: "/about", label: "About" },
			{ href: `${site.github}/blob/main/CHANGELOG.md`, label: "Changelog" },
			{ href: `${site.github}/blob/main/LICENSE`, label: "Licence" },
			{ href: "/privacy", label: "Privacy" },
		],
	},
] as const;

function FooterLink({ href, label }: { href: string; label: string }) {
	const className =
		"inline-flex min-h-11 items-center text-small text-muted transition-colors hover:text-foreground sm:min-h-0";
	if (href.startsWith("http")) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={className}>
				{label}
			</a>
		);
	}
	return (
		<Link href={href} className={className}>
			{label}
		</Link>
	);
}

export function Footer() {
	return (
		<footer className="border-t border-border">
			<Container>
				<div className="grid grid-cols-2 gap-x-6 gap-y-12 pt-20 pb-16 sm:grid-cols-12">
					<div className="col-span-2 sm:col-span-12 lg:col-span-5">
						<LogoMark className="size-10 rounded-xl" />
						<Eyebrow className="mt-8">Self-hosted paas</Eyebrow>
						<p className="mt-2 text-body text-foreground">Free to self-host, Apache-2.0.</p>
						<Pill href="/docs/install" variant="outline" size="sm" className="mt-4">
							Install guide
						</Pill>
					</div>
					{columns.map((column, index) => (
						<div
							key={column.heading}
							className={
								index === 0
									? "sm:col-span-4 lg:col-span-2 lg:col-start-7"
									: "sm:col-span-4 lg:col-span-2"
							}
						>
							<p className="text-body font-semibold text-foreground">{column.heading}</p>
							<ul className="mt-5 flex flex-col gap-3">
								{column.links.map((link) => (
									<li key={link.href}>
										<FooterLink href={link.href} label={link.label} />
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
				<div className="flex items-center justify-between gap-6 border-t border-border py-6 text-micro text-muted-2">
					<p>© 2026 Nixploy · Apache-2.0</p>
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						aria-label="Nixploy on GitHub"
						className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted transition-colors hover:text-foreground"
					>
						<GithubIcon className="size-4" aria-hidden />
					</a>
				</div>
			</Container>
		</footer>
	);
}
