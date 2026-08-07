"use client";

import Image from "next/image";
import { useState } from "react";

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
] as const;

export function Showcase() {
	const [active, setActive] = useState(0);
	const current = slides[active] ?? slides[0];

	return (
		<section id="showcase" className="border-t border-border py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-xl">
					<p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Product</p>
					<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						Know what’s running.
					</h2>
					<p className="mt-4 text-muted">
						Every service, domain, deployment, and metric from one dashboard.
					</p>
				</div>

				<div className="mt-10 flex flex-wrap gap-1 border-b border-border">
					{slides.map((slide, i) => (
						<button
							key={slide.label}
							type="button"
							onClick={() => setActive(i)}
							className={`border-b-2 px-3.5 py-3 text-sm transition-colors ${
								i === active
									? "border-foreground text-foreground"
									: "border-transparent text-muted hover:text-foreground"
							}`}
						>
							{slide.label}
						</button>
					))}
				</div>

				<div className="mt-7 overflow-hidden rounded-lg border border-border bg-surface">
					<Image
						src={current.src}
						alt={current.caption}
						width={1600}
						height={1000}
						className="h-auto w-full"
					/>
				</div>
				<p className="mt-4 text-sm text-muted">{current.caption}</p>
			</div>
		</section>
	);
}
