"use client";

import {
	Boxes,
	Cloud,
	Database,
	GitBranch,
	Globe,
	KeyRound,
	Layers,
	LineChart,
	Server,
	Shield,
	Terminal,
	Workflow,
} from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { TextAnimate } from "@/components/magicui/text-animate";

const capabilities = [
	{
		Icon: GitBranch,
		title: "Flexible application deploys",
		body: "Ship from Git with Nixpacks, Dockerfile, buildpacks, static sites, or a prebuilt image — pick what fits the stack.",
	},
	{
		Icon: Boxes,
		title: "Native Compose support",
		body: "Run full Docker Compose / Swarm stacks beside your apps without bolting on a separate orchestrator UI.",
	},
	{
		Icon: Server,
		title: "Local and remote servers",
		body: "Deploy on the machine running Nixploy or SSH into remote Swarm nodes when you need more capacity.",
	},
	{
		Icon: KeyRound,
		title: "Org roles & audit trail",
		body: "Admin / member roles for destructive actions, with meaningful mutations recorded for accountability.",
	},
	{
		Icon: Database,
		title: "Databases with backups",
		body: "Postgres, MySQL, MariaDB, Mongo, and Redis — plus scheduled backups and restores from the panel.",
	},
	{
		Icon: Terminal,
		title: "API & CLI",
		body: "REST with x-api-key, OpenAPI on your panel, and @nixploy/cli for the same workflows in a terminal.",
	},
	{
		Icon: Layers,
		title: "Docker Swarm ready",
		body: "Scale services across nodes with Swarm as the runtime — Traefik sits on the edge for routing and TLS.",
	},
	{
		Icon: Workflow,
		title: "Open source templates",
		body: "One-click catalogs for common stacks, then own the compose, env, and domains from day one.",
	},
	{
		Icon: Shield,
		title: "No vendor lock-in",
		body: "Your servers, your config dir, your Traefik. Leave anytime — nothing proprietary holds the workloads.",
	},
	{
		Icon: LineChart,
		title: "Live monitoring",
		body: "Stream logs, watch deploy history, and keep metrics snapshots so status matches reality.",
	},
	{
		Icon: Globe,
		title: "Domains & Let's Encrypt",
		body: "Attach custom domains and get certificates through Traefik without a separate cert dance.",
	},
	{
		Icon: Cloud,
		title: "Self-hosted & open source",
		body: "Apache-2.0. One curl installs the panel. You keep the control plane on infrastructure you trust.",
	},
] as const;

export function Capabilities() {
	return (
		<section id="features" className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="mx-auto max-w-2xl text-center">
					<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
						Capabilities
					</p>
					<TextAnimate
						as="h2"
						by="word"
						animation="blurInUp"
						once
						className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
					>
						Powerful deployment, tailored to you
					</TextAnimate>
					<p className="mt-4 text-neutral-400">
						Multi-server deploys, databases, Traefik TLS, and a real API — on metal you control.
					</p>
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
