"use client";

import { Check } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";

const panels = [
	{
		eyebrow: "Projects & environments",
		title: "Staging and production, side by side.",
		body: "Group services into projects, then split them across environments. Each environment carries its own variables, domains, and deployment history.",
		bullets: [
			"Per-environment variables and domains",
			"Clone a service into another environment in one click",
			"Tags, search, and per-org resource quotas",
		],
		imageSrc: "/screenshots/03-project.png",
		url: "panel.nixploy.local/projects",
		reverse: false,
	},
	{
		eyebrow: "Deployments",
		title: "Every deploy, recorded and reversible.",
		body: "Builds stream their logs live. When something breaks, roll back to any previous deployment — the failed one never takes the running version down.",
		bullets: [
			"Live build and runtime logs over websockets",
			"One-click rollback to any previous deploy",
			"Preview deployments for every pull request",
		],
		imageSrc: "/screenshots/04-service.png",
		url: "panel.nixploy.local/services",
		reverse: true,
	},
	{
		eyebrow: "Monitoring",
		title: "Metrics that match reality.",
		body: "Container-level CPU, memory, network, and disk for every service. Remote servers report over SSH, so a multi-node Swarm shows up in one view.",
		bullets: [
			"30-second samples, 48 hours of history",
			"Remote nodes sampled over SSH",
			"Threshold alerts through your notification channels",
		],
		imageSrc: "/screenshots/06-monitoring.png",
		url: "panel.nixploy.local/monitoring",
		reverse: false,
	},
	{
		eyebrow: "Templates",
		title: "86 stacks you can deploy before lunch.",
		body: "Supabase, Plausible, Ghost, Uptime Kuma, Ollama and 80 more. Deploy from the catalog and the compose file, env, and domains are yours from the start.",
		bullets: [
			"86 templates across 15 categories",
			"You own the compose file after deploy",
			"No hidden images or locked configs",
		],
		imageSrc: "/screenshots/07-templates.png",
		url: "panel.nixploy.local/templates",
		reverse: true,
	},
] as const;

export function ProductPanels() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto flex max-w-6xl flex-col gap-24 px-5 sm:gap-32 sm:px-6">
				{panels.map((panel, i) => (
					<div
						key={panel.title}
						className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-14 ${
							panel.reverse ? "lg:[&>*:first-child]:order-2" : ""
						}`}
					>
						<BlurFade delay={0.05} direction={panel.reverse ? "left" : "right"}>
							<div>
								<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
									{panel.eyebrow}
								</p>
								<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
									{panel.title}
								</h2>
								<p className="mt-4 max-w-md text-neutral-400">{panel.body}</p>
								<ul className="mt-6 space-y-2.5">
									{panel.bullets.map((bullet) => (
										<li key={bullet} className="flex items-start gap-2.5 text-sm text-neutral-300">
											<Check className="mt-0.5 size-4 shrink-0 text-neutral-500" strokeWidth={2} />
											{bullet}
										</li>
									))}
								</ul>
							</div>
						</BlurFade>
						<BlurFade delay={0.12} direction={panel.reverse ? "right" : "left"}>
							<div className="relative">
								<Safari imageSrc={panel.imageSrc} url={panel.url} />
								<BorderBeam
									size={100}
									duration={12}
									delay={i * 0.4}
									colorFrom="#ffffff"
									colorTo="#404040"
								/>
							</div>
						</BlurFade>
					</div>
				))}
			</div>
		</section>
	);
}
