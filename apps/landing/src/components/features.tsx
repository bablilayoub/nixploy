"use client";

import { Bot, Database, GitBranch, Globe, LineChart, Server } from "lucide-react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { MagicCard } from "@/components/magicui/magic-card";

const features = [
	{
		icon: GitBranch,
		title: "Deploy from Git",
		body: "Push a commit. Nixploy builds, deploys, and keeps a full deployment history.",
	},
	{
		icon: Globe,
		title: "Domains and SSL",
		body: "Add a domain and get routing plus Let's Encrypt certificates automatically.",
	},
	{
		icon: Database,
		title: "Databases included",
		body: "Provision Postgres, MySQL, Redis, MongoDB, and backups in the same place.",
	},
	{
		icon: Server,
		title: "Any server",
		body: "Run on a VPS, bare metal, or multiple Docker Swarm nodes over SSH.",
	},
	{
		icon: LineChart,
		title: "Observe everything",
		body: "Live metrics, logs, uptime probes, alert rules, and incident history.",
	},
	{
		icon: Bot,
		title: "Fix failures faster",
		body: "Let Deploy Copilot explain builds, logs, and likely next steps.",
	},
];

export function Features() {
	return (
		<section id="features" className="border-t border-white/10 bg-white/1.5 py-24 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<BlurFade inView>
					<div className="grid gap-6 md:grid-cols-2 md:items-end">
						<div>
							<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
								Everything in one place
							</p>
							<h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
								Deploy without the DevOps overhead.
							</h2>
						</div>
						<p className="max-w-md text-neutral-400">
							The essentials are built in so you can focus on your product instead of configuring a
							platform.
						</p>
					</div>
				</BlurFade>

				<div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-3">
					{features.map((feat, i) => (
						<BlurFade key={feat.title} delay={0.04 * i} inView>
							<MagicCard
								className="relative h-full rounded-none"
								gradientFrom="#737373"
								gradientTo="#262626"
								gradientColor="#151515"
							>
								<div className="relative h-full bg-[#090909] p-6">
									<feat.icon className="mb-8 size-5 text-neutral-300" strokeWidth={1.5} />
									<h3 className="text-[15px] font-medium text-white">{feat.title}</h3>
									<p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
										{feat.body}
									</p>
								</div>
							</MagicCard>
						</BlurFade>
					))}
				</div>
			</div>
		</section>
	);
}
