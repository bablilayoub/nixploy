import type { Metadata } from "next";
import Link from "next/link";

import { DocsShell } from "@/components/docs/docs-shell";
import { docsNav } from "@/lib/docs/nav";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description:
		"Install Nixploy, deploy apps and databases, configure domains, Git, backups, API, CLI, GitOps, and MCP.",
};

export default function DocsIndexPage() {
	return (
		<DocsShell activeHref="/docs">
			<article>
				<p className="mb-3 eyebrow">Docs</p>
				<h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					Documentation
				</h1>
				<p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
					Everything you need to run Nixploy in production — from the install one-liner to the REST
					API, CLI, GitOps, and MCP tools for agents.
				</p>

				<div className="mt-12 grid gap-8 sm:grid-cols-2">
					{docsNav.map((group) => (
						<section key={group.title} className="border-t border-border pt-5">
							<h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-foreground">
								{group.title}
							</h2>
							<ul className="space-y-2">
								{group.items.map((item) => (
									<li key={item.href}>
										<Link
											href={item.href}
											className="text-sm text-muted underline decoration-transparent underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40"
										>
											{item.label}
										</Link>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>

				<section className="mt-14 space-y-4 border-t border-border pt-10">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Quick path
					</h2>
					<ol className="list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
						<li>
							<Link href="/docs/install" className="text-foreground underline underline-offset-4">
								Install
							</Link>{" "}
							on a Linux host
						</li>
						<li>
							Complete{" "}
							<Link
								href="/docs/getting-started"
								className="text-foreground underline underline-offset-4"
							>
								getting started
							</Link>{" "}
							— owner wizard, first deploy
						</li>
						<li>
							Automate with the{" "}
							<Link href="/api" className="text-foreground underline underline-offset-4">
								REST API
							</Link>
							,{" "}
							<Link href="/docs/cli" className="text-foreground underline underline-offset-4">
								CLI
							</Link>
							, or{" "}
							<Link href="/docs/mcp" className="text-foreground underline underline-offset-4">
								MCP
							</Link>
						</li>
					</ol>
				</section>
			</article>
		</DocsShell>
	);
}
