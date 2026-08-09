"use client";

import { Boxes, Database, Globe, Hammer, Users, Wrench } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";

const capabilities = [
	{
		Icon: Hammer,
		title: "Builds your way",
		body: "Nixpacks, buildpacks, Dockerfile, static sites, or a prebuilt image — chosen per app, not per platform.",
	},
	{
		Icon: Database,
		title: "Databases with real backups",
		body: "Postgres, MySQL, MariaDB, MongoDB, and Redis. Scheduled dumps to S3-compatible storage, restores from the panel — and a backup of Nixploy itself.",
	},
	{
		Icon: Boxes,
		title: "Compose, first-class",
		body: "Paste a compose file or point at a repo. Stack or plain compose mode, with isolated deployments for side-by-side copies of the same stack.",
	},
	{
		Icon: Globe,
		title: "Domains & TLS",
		body: "Attach domains per service and Traefik issues Let's Encrypt certificates. Redirects and basic-auth rules live in the same tab.",
	},
	{
		Icon: Users,
		title: "Teams without drama",
		body: "Organizations with owner, admin, and member roles. Destructive actions check capabilities, land in the audit log, and can require 2FA org-wide.",
	},
	{
		Icon: Wrench,
		title: "Automate everything",
		body: "REST with OpenAPI on your own panel, @nixploy/cli for the terminal, and an MCP server so AI tools can deploy and inspect too.",
	},
] as const;

export function Capabilities() {
	return (
		<section id="features" className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-2xl">
					<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
						The rest of it
					</p>
					<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
						Everything a PaaS does, on hardware you already pay for.
					</h2>
				</div>

				<ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{capabilities.map((item, i) => (
						<li key={item.title}>
							<BlurFade delay={0.04 * i} inView>
								<div className="h-full rounded-xl border border-white/8 bg-white/[0.02] p-5 transition-colors hover:border-white/15 hover:bg-white/[0.04]">
									<div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-white/10 bg-black">
										<item.Icon className="size-5 text-white" strokeWidth={1.5} />
									</div>
									<h3 className="font-display text-base font-semibold tracking-tight text-white">
										{item.title}
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-neutral-400">{item.body}</p>
								</div>
							</BlurFade>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
