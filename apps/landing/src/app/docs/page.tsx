import { ArrowRight, DatabaseBackup, Globe, Rocket, Terminal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DocsFrame } from "@/components/docs-frame";
import { CodeBlock } from "@/components/ui/code-block";
import { docsNav } from "@/lib/docs/nav";
import { docsPages } from "@/lib/docs/pages";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description:
		"Install Nixploy, deploy apps and databases, configure domains, Git, backups, API, CLI, GitOps, and MCP.",
};

/**
 * The path through the docs, in the order it is actually walked: a host, an
 * account, something deployed, a domain on it, a backup of it. Numbered
 * because "where do I start" is the question this page exists to answer.
 */
const path = [
	{
		icon: Terminal,
		title: "Install the panel",
		text: "One command on a Linux host. Docker Swarm, Traefik, Postgres and the panel.",
		href: "/docs/install",
	},
	{
		icon: Rocket,
		title: "Ship the first service",
		text: "Finish the owner wizard, connect a repository, deploy it.",
		href: "/docs/getting-started",
	},
	{
		icon: Globe,
		title: "Put it on a domain",
		text: "Point a hostname at the box; Traefik issues the certificate.",
		href: "/docs/domains",
	},
	{
		icon: DatabaseBackup,
		title: "Make it survivable",
		text: "Scheduled backups to S3 or disk, and a restore you have tested.",
		href: "/docs/backups",
	},
] as const;

/** What each group of the sidebar is for, in one line. */
const groupSummaries: Record<string, string> = {
	Start: "Get a panel running and something deployed on it.",
	Platform: "The things you create: services, domains, data.",
	Operate: "Keeping it up, and getting in when it is not.",
	Automate: "The same surface without the panel — API, CLI, GitOps, agents.",
};

export default function DocsIndexPage() {
	return (
		<DocsFrame activeHref="/docs">
			<article>
				<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">Docs</p>
				<h1 className="mt-4 text-4xl font-semibold tracking-tight">Documentation</h1>
				<p className="mt-4 text-lg text-muted-foreground">
					Everything you need to run Nixploy in production — from the install one-liner to the REST
					API, CLI, GitOps, and MCP tools for agents.
				</p>

				<div className="mt-8">
					<CodeBlock language="bash" filename="install.sh" code={site.install} />
				</div>

				<section className="mt-10" aria-labelledby="start-here">
					<h2 id="start-here" className="text-xl font-semibold tracking-tight">
						Start here
					</h2>
					<ol className="mt-4 grid gap-3 sm:grid-cols-2">
						{path.map((item, index) => (
							<li key={item.href}>
								<Link
									href={item.href}
									className="group flex h-full gap-4 rounded-xl border p-5 transition-colors hover:border-foreground/25"
								>
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card">
										<item.icon className="size-4" aria-hidden />
									</span>
									<span className="min-w-0">
										<span className="flex items-baseline gap-2">
											<span className="font-mono text-xs text-muted-foreground">
												{String(index + 1).padStart(2, "0")}
											</span>
											<span className="font-medium">{item.title}</span>
											<ArrowRight
												className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
												aria-hidden
											/>
										</span>
										<span className="mt-1 block text-sm text-muted-foreground">{item.text}</span>
									</span>
								</Link>
							</li>
						))}
					</ol>
				</section>

				{/* Every page with the line it introduces itself by, rather than a
				    column of bare titles: the descriptions already exist on each page
				    and are what tells you which of "Deploy & build" and "GitOps" you
				    actually want. */}
				<section className="mt-14" aria-labelledby="browse">
					<h2 id="browse" className="text-xl font-semibold tracking-tight">
						Browse everything
					</h2>
					<div className="mt-4 flex flex-col gap-10">
						{docsNav.map((group) => (
							<div key={group.title}>
								<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-3">
									<h3 className="font-medium">{group.title}</h3>
									<p className="text-sm text-muted-foreground">
										{groupSummaries[group.title] ?? ""}
									</p>
								</div>
								<ul className="mt-1 flex flex-col">
									{group.items
										.filter((item) => !item.index)
										.map((item) => {
											const page = docsPages.find((entry) => `/docs/${entry.slug}` === item.href);
											return (
												<li key={item.href}>
													<Link
														href={item.href}
														className="group grid gap-x-6 gap-y-0.5 border-b py-3 transition-colors last:border-b-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
													>
														<span className="font-medium transition-colors group-hover:text-foreground">
															{item.label}
														</span>
														<span className="text-sm text-muted-foreground">
															{page?.description ?? "Reference"}
														</span>
													</Link>
												</li>
											);
										})}
								</ul>
							</div>
						))}
					</div>
				</section>
			</article>
		</DocsFrame>
	);
}
