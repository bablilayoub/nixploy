import Link from "next/link";

import { GithubIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
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
			{ href: `${site.github}/blob/main/LICENSE`, label: "License" },
			{ href: "/privacy", label: "Privacy" },
		],
	},
] as const;

/** Shared sitemap and a restrained wordmark close the public site. */
export function SiteFooter() {
	return (
		<footer className="signal-footer">
			<div className="container-page px-0">
				<div className="relative overflow-hidden px-0 pt-4">
					<div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-12">
						<div className="col-span-2 sm:col-span-12 lg:col-span-5">
							<Logo />
							<p className="mt-5 max-w-sm text-sm text-muted-foreground">
								A platform as a service you host yourself. Free to run, Apache-2.0.
							</p>
							<div className="mt-6 flex flex-wrap items-center gap-2">
								<Button asChild size="sm" className="rounded-lg">
									<Link href="/docs/install">Install guide</Link>
								</Button>
								<Button asChild variant="outline" size="sm" className="rounded-lg">
									<a href={site.github} target="_blank" rel="noreferrer">
										<GithubIcon className="size-4" aria-hidden />
										GitHub
									</a>
								</Button>
							</div>
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
												className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
											>
												{link.label}
											</Link>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>

					<div className="mt-12 flex flex-col gap-2 border-t py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
						<p>© 2026 Nixploy · Apache-2.0</p>
						<p>
							Built by{" "}
							<a
								href="https://abablil.me"
								target="_blank"
								rel="noreferrer"
								className="text-foreground underline underline-offset-4 hover:decoration-2"
							>
								Ayoub Bablil
							</a>
						</p>
					</div>
				</div>
			</div>
		</footer>
	);
}
