import { ArrowRight, Rocket, Terminal, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DocsFrame } from "@/components/docs-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { docsNav } from "@/lib/docs/nav";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description:
		"Install Nixploy, deploy apps and databases, configure domains, Git, backups, API, CLI, GitOps, and MCP.",
};

const start = [
	{
		icon: Terminal,
		title: "Install",
		text: "One install on a Linux host — Docker Swarm and Traefik included.",
		href: "/docs/install",
		cta: "Install guide",
	},
	{
		icon: Rocket,
		title: "First deploy",
		text: "Complete the owner wizard and ship your first deploy.",
		href: "/docs/getting-started",
		cta: "Getting started",
	},
	{
		icon: Workflow,
		title: "Automate",
		text: "The same surface from CI, a terminal or an agent.",
		href: "/docs/cli",
		cta: "CLI reference",
	},
] as const;

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

				<div className="mt-6 grid gap-4 sm:grid-cols-3">
					{start.map((item) => (
						<Card key={item.title} className="h-full p-5">
							<item.icon className="size-5 text-primary" aria-hidden />
							<h2 className="mt-3 font-medium">{item.title}</h2>
							<p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
							<Button asChild variant="link" className="mt-3 h-auto justify-start px-0">
								<Link href={item.href}>
									{item.cta}
									<ArrowRight className="size-3.5" />
								</Link>
							</Button>
						</Card>
					))}
				</div>

				<div className="mt-12 grid gap-4 sm:grid-cols-2">
					{docsNav.map((group) => (
						<Card key={group.title}>
							<CardContent>
								<h2 className="font-medium">{group.title}</h2>
								<ul className="mt-3 flex flex-col gap-2">
									{group.items.map((item) => (
										<li key={item.href}>
											<Link
												href={item.href}
												className="text-sm text-muted-foreground transition-colors hover:text-foreground"
											>
												{item.label}
											</Link>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					))}
				</div>
			</article>
		</DocsFrame>
	);
}
