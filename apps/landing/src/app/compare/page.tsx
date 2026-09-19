import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";

import { PageShell, ProseLink } from "@/components/page-shell";
import { Card, Panel, SectionTitle } from "@/components/ui";
import { comparisons, VERIFIED_ON } from "@/lib/compare";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Nixploy compared to the other self-hosted PaaS options",
	description:
		"Sourced, dated comparisons between Nixploy and Dokploy, Coolify and CapRover. Every claim about another project links to where it was read, including the ones where they win.",
	alternates: { canonical: `${site.url}/compare` },
};

/*
 * One card per comparison, the whole card a link, then how the pages are
 * written. The copy is bound by the rules at the top of lib/compare.ts:
 * nothing on this page asserts anything about another project.
 */
export default function ComparePage() {
	return (
		<PageShell
			eyebrow="Compare"
			title="How Nixploy compares"
			description="This category is crowded, and three of these projects are older and larger than this one. Here is where each actually differs — sourced, dated, and including the rows where they win."
		>
			<div className="grid gap-4 lg:grid-cols-3">
				{comparisons.map((entry) => (
					<Card
						key={entry.slug}
						href={`/nixploy-vs-${entry.slug}`}
						label={`Nixploy vs ${entry.name}`}
						className="group p-8 sm:p-10"
					>
						{/* The card is the link, so the trailing "Read the comparison" is text, not a nested anchor. */}
						<div className="flex h-full flex-col">
							<h2 className="text-title text-foreground">Nixploy vs {entry.name}</h2>
							<p className="mt-2 font-mono text-micro text-muted-2">{entry.stars} stars</p>
							<p className="mt-5 flex-1 text-body text-muted">{entry.headline}</p>
							<span className="mt-8 inline-flex items-center gap-1 text-body font-medium text-accent-strong transition-colors group-hover:text-foreground">
								Read the comparison
								<ChevronRight
									className="size-4 transition-transform group-hover:translate-x-0.5"
									aria-hidden
								/>
							</span>
						</div>
					</Card>
				))}
			</div>

			<section className="mt-32">
				<SectionTitle title="How these are written" />
				<div className="mt-12 grid gap-4 md:grid-cols-2">
					<Panel>
						<h3 className="text-body font-medium text-foreground">Everything is sourced</h3>
						<p className="mt-2 text-small text-muted">
							Each claim about another project links to the pricing page, licence file or
							documentation it was read from — read, not remembered. Two of them contradicted what a
							search summary said.
						</p>
					</Panel>
					<Panel>
						<h3 className="text-body font-medium text-foreground">Dated</h3>
						<p className="mt-2 text-small text-muted">
							Last checked {VERIFIED_ON}. These projects ship weekly; if a row is stale,{" "}
							<ProseLink href={`${site.github}/issues`}>open an issue</ProseLink> and it gets fixed.
						</p>
					</Panel>
					<Panel>
						<h3 className="text-body font-medium text-foreground">No mudslinging</h3>
						<p className="mt-2 text-small text-muted">
							No claims about anybody else&apos;s reliability, memory use or security history. Those
							age badly and are not ours to make.
						</p>
					</Panel>
					<Panel>
						<h3 className="text-body font-medium text-foreground">
							Every page says where they win
						</h3>
						<p className="mt-2 text-small text-muted">
							One of these three does not paywall anything at all, and the page for it says so in
							the heading. A comparison whose author wins every row is an advertisement.
						</p>
					</Panel>
				</div>
			</section>
		</PageShell>
	);
}
