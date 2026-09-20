import Link from "next/link";

import { GithubIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { site } from "@/lib/site";

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

export function SiteFooter() {
	return (
		<footer className="px-6 pb-10">
			<div className="mx-auto max-w-7xl">
				<Separator />
				<div className="grid grid-cols-2 gap-x-6 gap-y-12 py-14 sm:grid-cols-12">
					<div className="col-span-2 sm:col-span-12 lg:col-span-5">
						<Logo />
						<p className="mt-6 max-w-xs text-sm text-muted-foreground">
							A platform as a service you host yourself. Free to run, Apache-2.0.
						</p>
						<Button asChild variant="outline" size="sm" className="mt-5 rounded-lg">
							<Link href="/docs/install">Install guide</Link>
						</Button>
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
							<p className="text-sm font-medium">{column.heading}</p>
							<ul className="mt-3 flex flex-col">
								{column.links.map((link) => (
									<li key={link.href}>
										<Link
											href={link.href}
											className="inline-flex min-h-9 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
										>
											{link.label}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
				<Separator />
				<div className="flex items-center justify-between gap-6 pt-6 text-xs text-muted-foreground">
					<p>© 2026 Nixploy · Apache-2.0</p>
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						aria-label="Nixploy on GitHub"
						className="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
					>
						<GithubIcon className="size-4" aria-hidden />
					</a>
				</div>
			</div>
		</footer>
	);
}
