"use client";

import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";
import { TextAnimate } from "@/components/magicui/text-animate";

const panels = [
	{
		eyebrow: "Control plane",
		title: "Projects, environments, services — one panel.",
		body: "Organize apps and databases the way you ship: org → project → environment → service. Deploy from Git or the CLI.",
		imageSrc: "/screenshots/03-project.png",
		url: "panel.nixploy.local/projects",
		reverse: false,
	},
	{
		eyebrow: "Templates",
		title: "One-click stacks when you want speed.",
		body: "Spin up common apps and databases from the catalog, then own the compose and env from day one.",
		imageSrc: "/screenshots/06-templates.png",
		url: "panel.nixploy.local/templates",
		reverse: true,
	},
	{
		eyebrow: "Control center",
		title: "Docker visibility without leaving the panel.",
		body: "Inspect containers, images, and networks on the host — the same Swarm your deploys land on.",
		imageSrc: "/screenshots/07-docker.png",
		url: "panel.nixploy.local/docker",
		reverse: false,
	},
] as const;

export function ProductPanels() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto flex max-w-6xl flex-col gap-24 px-5 sm:px-6">
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
								<TextAnimate
									as="h2"
									animation="blurInUp"
									by="word"
									once
									className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
								>
									{panel.title}
								</TextAnimate>
								<p className="mt-4 max-w-md text-neutral-400">{panel.body}</p>
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
