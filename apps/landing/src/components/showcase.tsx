"use client";

import { useState } from "react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";

const slides = [
	{
		src: "/screenshots/03-project.png",
		label: "Projects",
		caption: "Environments, services, and GitOps in one place.",
	},
	{
		src: "/screenshots/05-tab-deployments.png",
		label: "Deployments",
		caption: "Build logs, status, and failure explain.",
	},
	{
		src: "/screenshots/05-tab-monitoring.png",
		label: "Monitoring",
		caption: "CPU, memory, alerts — live and historical.",
	},
	{
		src: "/screenshots/05-tab-logs.png",
		label: "Logs",
		caption: "Stream and search without SSHing in.",
	},
	{
		src: "/screenshots/06-templates.png",
		label: "Templates",
		caption: "One-click stacks from the catalog.",
	},
];

export function Showcase() {
	const [active, setActive] = useState(0);
	const current = slides[active] ?? slides[0];

	return (
		<section id="showcase" className="border-t border-white/10 py-24 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<BlurFade inView>
					<div className="grid gap-6 md:grid-cols-2 md:items-end">
						<div>
							<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
								One control plane
							</p>
							<h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
								Know what’s running.
							</h2>
						</div>
						<p className="max-w-md text-neutral-400">
							Every service, domain, deployment, and metric is available from one clear dashboard.
						</p>
					</div>
				</BlurFade>

				<div className="mt-10 flex flex-wrap gap-1 border-b border-white/10">
					{slides.map((slide, i) => (
						<button
							key={slide.label}
							type="button"
							onClick={() => setActive(i)}
							className={`border-b-2 px-3.5 py-3 text-sm transition-colors ${
								i === active
									? "border-white text-white"
									: "border-transparent text-neutral-500 hover:text-white"
							}`}
						>
							{slide.label}
						</button>
					))}
				</div>

				<BlurFade inView delay={0.1}>
					<div className="relative mt-7 overflow-hidden rounded-lg border border-white/10">
						<BorderBeam size={80} duration={12} colorFrom="#fff" colorTo="#404040" />
						<Safari url="panel.nixploy.com" imageSrc={current.src} className="size-full" />
					</div>
					<p className="mt-4 text-sm text-neutral-500">{current.caption}</p>
				</BlurFade>
			</div>
		</section>
	);
}
