"use client";

import { Activity, Database, GitBranch, Globe, Layers, Terminal } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { SpotlightCard } from "@/components/magicui/spotlight-card";
import { Container, SectionHeading } from "@/components/ui";
import { features } from "@/lib/landing-data";

const icons = {
	git: GitBranch,
	layers: Layers,
	database: Database,
	globe: Globe,
	activity: Activity,
	terminal: Terminal,
} as const;

export function Features() {
	return (
		<section id="features" className="py-16 sm:py-24">
			<Container>
				<BlurFade inView>
					<SectionHeading
						align="center"
						title="Everything you need"
						lede="A complete platform to build, ship, expose, observe and operate — on hardware you already pay for."
					/>
				</BlurFade>
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{features.map((feature, i) => {
						const Icon = icons[feature.icon];
						return (
							<BlurFade key={feature.title} inView delay={0.05 * i}>
								<SpotlightCard className="h-full p-6 text-center sm:p-8">
									<span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-surface-2 text-foreground">
										<Icon className="size-5" strokeWidth={1.6} />
									</span>
									<h3 className="mt-5 font-display text-base font-semibold text-foreground">
										{feature.title}
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
								</SpotlightCard>
							</BlurFade>
						);
					})}
				</div>
			</Container>
		</section>
	);
}
