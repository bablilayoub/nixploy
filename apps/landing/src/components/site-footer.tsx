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

/**
 * The footer is a panel, not a strip: one rounded surface holding the columns,
 * the legal line, and the wordmark set large enough to end the page.
 *
 * The wordmark is decoration — `aria-hidden`, unselectable, clipped by the
 * panel and faded into it, so it reads as a watermark rather than a heading a
 * screen reader has to announce. It is sized in `vw` and the panel hides its
 * overflow, which is what keeps it from widening the page at any viewport.
 */
export function SiteFooter() {
	return (
		<footer className="px-6 pb-6">
			<div className="container-page px-0">
				<div className="relative overflow-hidden rounded-2xl border bg-card/40 px-6 pt-12 sm:px-10">
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

					{/* The wordmark closes the panel: full width, nothing cropped, and
					    space of its own above and below. `textLength` is what makes it
					    exactly as wide as the panel at every viewport — a size in `vw`
					    depends on the font's metrics and overshoots or leaves a gap. */}
					<svg
						aria-hidden
						viewBox="0 0 1000 198"
						preserveAspectRatio="xMidYMid meet"
						className="mt-12 mb-8 block w-full select-none"
						role="presentation"
					>
						<title>Nixploy</title>
						<text
							x="0"
							y="158"
							textLength="1000"
							lengthAdjust="spacingAndGlyphs"
							fontSize="210"
							fontWeight="600"
							className="fill-foreground/[0.16]"
						>
							nixploy
						</text>
					</svg>

					<div className="flex flex-col gap-2 border-t py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
						<p>© 2026 Nixploy · Apache-2.0</p>
						<p>
							Built by{" "}
							<a
								href="https://abablil.me"
								target="_blank"
								rel="noreferrer"
								className="text-foreground underline-offset-4 hover:underline"
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
