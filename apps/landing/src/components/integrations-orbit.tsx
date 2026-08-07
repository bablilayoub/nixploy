"use client";

import { Boxes, Database, GitBranch, Globe, Server, Terminal } from "lucide-react";

import { LogoMark } from "@/components/logo";
import { BlurFade } from "@/components/magicui/blur-fade";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";
import { TextAnimate } from "@/components/magicui/text-animate";

function OrbitIcon({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex size-full items-center justify-center rounded-full border border-white/15 bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
			{children}
		</div>
	);
}

export function IntegrationsOrbit() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-2">
				<BlurFade>
					<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
						Integrations
					</p>
					<TextAnimate
						as="h2"
						animation="blurInUp"
						by="word"
						once
						className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
					>
						Everything orbits your control plane
					</TextAnimate>
					<p className="mt-4 max-w-md text-neutral-400">
						Git providers, databases, Traefik, Swarm, and the CLI all hang off one panel — not a
						scatter of dashboards.
					</p>
				</BlurFade>

				<BlurFade delay={0.1}>
					<div className="relative mx-auto flex h-[420px] w-full max-w-md items-center justify-center overflow-hidden">
						<span className="absolute z-10 flex size-16 items-center justify-center rounded-full border border-white/20 bg-black">
							<LogoMark className="size-10" />
						</span>
						<OrbitingCircles iconSize={40} radius={140} speed={1}>
							<OrbitIcon>
								<GitBranch className="size-5" />
							</OrbitIcon>
							<OrbitIcon>
								<Database className="size-5" />
							</OrbitIcon>
							<OrbitIcon>
								<Globe className="size-5" />
							</OrbitIcon>
							<OrbitIcon>
								<Boxes className="size-5" />
							</OrbitIcon>
							<OrbitIcon>
								<Terminal className="size-5" />
							</OrbitIcon>
						</OrbitingCircles>
						<OrbitingCircles iconSize={32} radius={90} reverse speed={1.4}>
							<OrbitIcon>
								<Server className="size-4" />
							</OrbitIcon>
							<OrbitIcon>
								<span className="font-mono text-[10px] font-semibold">TLS</span>
							</OrbitIcon>
							<OrbitIcon>
								<span className="font-mono text-[10px] font-semibold">API</span>
							</OrbitIcon>
							<OrbitIcon>
								<span className="font-mono text-[10px] font-semibold">CLI</span>
							</OrbitIcon>
						</OrbitingCircles>
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
