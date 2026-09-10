"use client";

import { useState } from "react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, SectionHeading } from "@/components/ui";
import { automationSamples } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

const tabs = [
	{
		id: "rest",
		label: "REST",
		title: "curl",
		body: "Every tRPC procedure is a REST endpoint. Swagger lives on your own panel.",
	},
	{
		id: "cli",
		label: "CLI",
		title: "@nixploy/cli",
		body: "npm install once, drive projects, apps, compose stacks, env and domains from any terminal or CI job.",
	},
	{
		id: "mcp",
		label: "MCP",
		title: "claude_desktop_config.json",
		body: "Point Claude, Cursor or any MCP client at /api/mcp. Same permissions, same audit log as a human.",
	},
] as const;

export function Automation() {
	const [active, setActive] = useState<(typeof tabs)[number]["id"]>("rest");
	const tab = tabs.find((t) => t.id === active) ?? tabs[0];

	return (
		<section id="automation" className="py-20 sm:py-28">
			<Container>
				<div className="grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:items-start lg:gap-14">
					<BlurFade inView>
						<SectionHeading
							eyebrow="Automation"
							title="The panel is an API. So is your assistant."
							lede="Humans click, CI curls, agents call tools — all through one org-scoped surface with per-key rate limits and capability checks."
						/>
						<div className="mt-8 flex gap-2">
							{tabs.map((t) => (
								<button
									key={t.id}
									type="button"
									onClick={() => setActive(t.id)}
									className={cn(
										"rounded-lg border px-4 py-2 text-sm transition-colors",
										active === t.id
											? "border-accent/60 bg-accent-soft text-foreground"
											: "border-border bg-surface text-muted hover:text-foreground",
									)}
								>
									{t.label}
								</button>
							))}
						</div>
						<p className="mt-4 max-w-md text-sm leading-relaxed text-muted">{tab.body}</p>
						<ul className="mt-6 space-y-2 text-sm text-muted">
							<li>
								· GitOps: export a project as{" "}
								<span className="font-mono text-foreground">nixploy.yaml</span>, plan, apply, sync
								from a URL
							</li>
							<li>· Webhooks for GitHub, GitLab, Bitbucket, Gitea and a generic deploy hook</li>
							<li>· Scheduled commands, uptime probes and alert rules per service</li>
						</ul>
					</BlurFade>
					<BlurFade inView delay={0.1}>
						<div className="overflow-hidden rounded-xl border border-border bg-[#0c0e12]">
							<div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
								<span className="size-2.5 rounded-full bg-[#ff5f57]" />
								<span className="size-2.5 rounded-full bg-[#febc2e]" />
								<span className="size-2.5 rounded-full bg-[#28c840]" />
								<span className="ml-3 font-mono text-[11px] text-muted-2">{tab.title}</span>
							</div>
							<pre className="code overflow-x-auto p-5 text-[12.5px] whitespace-pre text-foreground/85">
								{automationSamples[tab.id]}
							</pre>
						</div>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
