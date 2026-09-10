"use client";

import { useState } from "react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";
import { Container, SectionHeading } from "@/components/ui";
import { cn } from "@/lib/utils";

const views = [
	{
		id: "dashboard",
		label: "Dashboard",
		src: "/screenshots/02-dashboard.png",
		url: "panel.example.com/dashboard",
		blurb:
			"Every project, environment and service at a glance — with deploy history for the last two weeks.",
	},
	{
		id: "service",
		label: "Application",
		src: "/screenshots/04-service.png",
		url: "panel.example.com/…/services/application",
		blurb:
			"Source, build, env, domains, deployments, previews, logs, monitoring and Swarm tuning in one place.",
	},
	{
		id: "monitoring",
		label: "Monitoring",
		src: "/screenshots/06-monitoring.png",
		url: "panel.example.com/…/monitoring",
		blurb:
			"Per-container CPU, memory, network and disk with 48 hours of history and threshold alerts.",
	},
	{
		id: "templates",
		label: "Templates",
		src: "/screenshots/07-templates.png",
		url: "panel.example.com/dashboard/templates",
		blurb:
			"86 stacks across 15 categories. Deploy one and the compose file is yours to edit afterwards.",
	},
] as const;

export function PanelPreview() {
	const [active, setActive] = useState<(typeof views)[number]["id"]>("dashboard");
	const view = views.find((v) => v.id === active) ?? views[0];

	return (
		<section className="pt-20 pb-8 sm:pt-28 sm:pb-12">
			<Container>
				<BlurFade inView>
					<SectionHeading
						align="center"
						eyebrow="The panel"
						title="A control room, not a dashboard."
						lede="Dense where it should be, quiet everywhere else. Dark and light, keyboard-first, with a command palette for every action."
					/>
				</BlurFade>

				<BlurFade inView delay={0.08}>
					<div className="mt-10 flex flex-wrap justify-center gap-2">
						{views.map((v) => (
							<button
								key={v.id}
								type="button"
								onClick={() => setActive(v.id)}
								className={cn(
									"rounded-full border px-4 py-1.5 text-sm transition-colors",
									active === v.id
										? "border-accent/60 bg-accent-soft text-foreground"
										: "border-border bg-surface text-muted hover:text-foreground",
								)}
							>
								{v.label}
							</button>
						))}
					</div>
					<p className="mx-auto mt-4 max-w-xl text-center text-sm text-muted">{view.blurb}</p>
				</BlurFade>

				<BlurFade inView delay={0.14} className="relative mt-8">
					<div className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(50%_50%_at_50%_30%,rgba(242,181,61,0.12),transparent_70%)] blur-3xl" />
					<div className="relative">
						<Safari key={view.id} imageSrc={view.src} url={view.url} />
						<BorderBeam size={140} duration={12} colorFrom="#f2b53d" colorTo="#79cdff" />
					</div>
				</BlurFade>
			</Container>
		</section>
	);
}
