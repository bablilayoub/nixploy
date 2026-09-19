import type { LucideIcon } from "lucide-react";
import {
	Activity,
	Bot,
	Database,
	DatabaseBackup,
	GitBranch,
	GitPullRequest,
	Globe,
	Layers,
	LayoutGrid,
	RotateCcw,
	SquareTerminal,
	Users,
} from "lucide-react";

import { Container, SectionTitle } from "@/components/ui";
import { type FeatureIcon, features } from "@/lib/landing-data";

/*
 * Twelve claims in one hairline grid: an icon, a title and one sentence per
 * cell, no cards and no hover. The hairlines are the 1px gap showing the
 * border colour through page-coloured cells, so every neighbour gets exactly
 * one line at every column count and the outer border alone draws the edge.
 */

const icons: Record<FeatureIcon, LucideIcon> = {
	git: GitBranch,
	compose: Layers,
	database: Database,
	globe: Globe,
	activity: Activity,
	backup: DatabaseBackup,
	preview: GitPullRequest,
	rollback: RotateCcw,
	team: Users,
	api: SquareTerminal,
	agent: Bot,
	templates: LayoutGrid,
};

export function Features() {
	return (
		<section className="py-24 lg:py-32">
			<Container>
				<SectionTitle title="Everything a deploy needs">
					Build, ship, expose, observe, recover and automate, on Swarm and Traefik you control.
				</SectionTitle>
				<ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
					{features.map((feature) => {
						const Icon = icons[feature.icon];
						return (
							<li key={feature.title} className="bg-background p-8">
								<Icon className="size-5 text-foreground" aria-hidden />
								<h3 className="mt-6 text-body font-semibold text-foreground">{feature.title}</h3>
								<p className="mt-2 text-small text-muted">{feature.text}</p>
							</li>
						);
					})}
				</ul>
			</Container>
		</section>
	);
}
