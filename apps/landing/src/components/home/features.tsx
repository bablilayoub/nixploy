import {
	Activity,
	Archive,
	Database,
	GitBranch,
	GitPullRequest,
	Lock,
	Server,
	Terminal,
} from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Section, SectionHeading } from "@/components/ui";
import { features } from "@/lib/landing-data";

const icons = {
	git: GitBranch,
	lock: Lock,
	database: Database,
	archive: Archive,
	activity: Activity,
	branch: GitPullRequest,
	server: Server,
	terminal: Terminal,
} as const;

export function Features() {
	return (
		<Section id="features">
			<BlurFade inView>
				<SectionHeading
					eyebrow="Features"
					title="Everything a deploy needs"
					lede="Build, ship, expose, observe and operate — without assembling it yourself."
				/>
			</BlurFade>

			{/*
			 * A ruled grid rather than floating cards: one hairline between cells,
			 * nothing to hover, nothing to shadow.
			 */}
			<div className="mt-14 grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
				{features.map((feature, i) => {
					const Icon = icons[feature.icon];
					return (
						<BlurFade key={feature.title} inView delay={0.03 * i}>
							<div className="h-full border-b border-border px-0 py-7 sm:px-6 sm:[&:nth-child(odd)]:pl-0 lg:border-l lg:px-6 lg:first:border-l-0 lg:[&:nth-child(4n+1)]:border-l-0 lg:[&:nth-child(odd)]:pl-6">
								<Icon className="size-[18px] text-foreground" strokeWidth={1.6} />
								<h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
									{feature.title}
								</h3>
								<p className="mt-2 text-[13.5px] leading-relaxed text-muted">{feature.body}</p>
							</div>
						</BlurFade>
					);
				})}
			</div>
		</Section>
	);
}
