import { Rocket, Terminal, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DocsShell } from "@/components/docs/docs-shell";
import { InstallCommand } from "@/components/install-command";
import { Card, Eyebrow, LearnMore, Panel, Tile } from "@/components/ui";
import { docsNav } from "@/lib/docs/nav";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description:
		"Install Nixploy, deploy apps and databases, configure domains, Git, backups, API, CLI, GitOps, and MCP.",
};

/*
 * The docs landing: the reference's three quick-start cards (install, first
 * deploy, automate) over the whole group list. The groups are the sidebar's
 * own data, so a new page appears here without a second edit.
 */
export default function DocsIndexPage() {
	return (
		<DocsShell activeHref="/docs">
			<article>
				<Eyebrow className="mb-4">Docs</Eyebrow>
				<h1 className="text-title text-balance text-foreground sm:text-headline">Documentation</h1>
				<p className="mt-4 text-lead text-muted">
					Everything you need to run Nixploy in production — from the install one-liner to the REST
					API, CLI, GitOps, and MCP tools for agents.
				</p>

				{/*
				 * Three quick-start cards as rows, not columns: the reading column is
				 * 48rem, and three cards across it left every sentence wrapping at
				 * four words. Icon on the left, the card's one action on the right
				 * of its sentence.
				 */}
				<div className="mt-12 flex flex-col gap-4">
					<Card className="flex flex-col gap-5 p-6 sm:flex-row sm:gap-6 sm:p-8">
						<Tile size={48} className="shrink-0">
							<Terminal className="size-5" aria-hidden />
						</Tile>
						<div className="min-w-0 flex-1">
							<h2 className="text-subtitle text-foreground">Install</h2>
							<p className="mt-2 text-body text-muted">
								One install on a Linux host — Docker Swarm and Traefik included.
							</p>
							<InstallCommand className="mt-5" />
							<LearnMore href="/docs/install" className="mt-5">
								Install guide
							</LearnMore>
						</div>
					</Card>
					<Card className="flex flex-col gap-5 p-6 sm:flex-row sm:gap-6 sm:p-8">
						<Tile size={48} className="shrink-0">
							<Rocket className="size-5" aria-hidden />
						</Tile>
						<div className="min-w-0 flex-1">
							<h2 className="text-subtitle text-foreground">First deploy</h2>
							<p className="mt-2 text-body text-muted">
								Complete the owner wizard and ship your first deploy.
							</p>
							<LearnMore href="/docs/getting-started" className="mt-5">
								Getting started
							</LearnMore>
						</div>
					</Card>
					<Card className="flex flex-col gap-5 p-6 sm:flex-row sm:gap-6 sm:p-8">
						<Tile size={48} className="shrink-0">
							<Workflow className="size-5" aria-hidden />
						</Tile>
						<div className="min-w-0 flex-1">
							<h2 className="text-subtitle text-foreground">Automate</h2>
							<p className="mt-2 text-body text-muted">
								The same surface from CI, a terminal or an agent.
							</p>
							<div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
								<LearnMore href="/api">REST API</LearnMore>
								<LearnMore href="/docs/cli">CLI</LearnMore>
								<LearnMore href="/docs/mcp">MCP</LearnMore>
							</div>
						</div>
					</Card>
				</div>

				<div className="mt-16 grid gap-4 sm:grid-cols-2">
					{docsNav.map((group) => (
						<Panel key={group.title}>
							<h2 className="text-body font-medium text-foreground">{group.title}</h2>
							<ul className="mt-3 flex flex-col gap-2">
								{group.items.map((item) => (
									<li key={item.href}>
										<Link
											href={item.href}
											className="text-small text-muted transition-colors hover:text-foreground"
										>
											{item.label}
										</Link>
									</li>
								))}
							</ul>
						</Panel>
					))}
				</div>
			</article>
		</DocsShell>
	);
}
