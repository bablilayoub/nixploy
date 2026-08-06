"use client";

import { Check } from "lucide-react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";

export function HowItWorks() {
	return (
		<section id="how" className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-28">
			<div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
				<BlurFade inView>
					<div>
						<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
							Simple by design
						</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
							From server to production in minutes.
						</h2>
						<p className="mt-5 max-w-md leading-relaxed text-neutral-400">
							Nixploy handles the plumbing behind a dependable deployment workflow, while you keep
							full control of the infrastructure.
						</p>
						<ul className="mt-7 space-y-3 text-sm text-neutral-300">
							{[
								"One-command installer",
								"Automatic Docker Swarm and Traefik setup",
								"Bring any Git repo, image, or compose file",
							].map((item) => (
								<li key={item} className="flex items-center gap-2">
									<Check className="size-4 text-neutral-400" /> {item}
								</li>
							))}
						</ul>
					</div>
				</BlurFade>

				<BlurFade inView delay={0.1}>
					<div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0b0b0b] font-mono text-sm">
						<BorderBeam size={70} duration={12} colorFrom="#fff" colorTo="#404040" />
						<div className="flex items-center gap-1.5 border-b border-white/10 px-5 py-4">
							<span className="size-2 rounded-full bg-neutral-600" />
							<span className="size-2 rounded-full bg-neutral-600" />
							<span className="size-2 rounded-full bg-neutral-600" />
						</div>
						<div className="space-y-4 p-6 text-neutral-400">
							<p>
								<span className="mr-2 text-white">$</span>
								curl -fsSL nixploy.com/install.sh | sudo bash
							</p>
							<div className="space-y-1 text-xs leading-relaxed text-neutral-500">
								<p>✓ Docker ready</p>
								<p>✓ Swarm initialized</p>
								<p>✓ Traefik configured</p>
								<p>✓ Dashboard available at https://panel.yourdomain.com</p>
							</div>
							<p className="pt-2 text-white">
								<span className="mr-2">$</span>
								<span className="inline-block h-4 w-1.5 animate-pulse bg-white align-middle" />
							</p>
						</div>
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
