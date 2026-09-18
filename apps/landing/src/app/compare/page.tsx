import type { Metadata } from "next";
import Link from "next/link";

import { PageShell, ProseLink } from "@/components/page-shell";
import { comparisons, VERIFIED_ON } from "@/lib/compare";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Nixploy compared to the other self-hosted PaaS options",
	description:
		"Sourced, dated comparisons between Nixploy and Dokploy, Coolify and CapRover. Every claim about another project links to where it was read, including the ones where they win.",
	alternates: { canonical: `${site.url}/compare` },
};

export default function ComparePage() {
	return (
		<PageShell
			wide
			eyebrow="Compare"
			title="How Nixploy compares"
			description="This category is crowded, and three of these projects are older and larger than this one. Here is where each actually differs — sourced, dated, and including the rows where they win."
		>
			<div className="space-y-4">
				{comparisons.map((entry) => (
					<Link
						key={entry.slug}
						href={`/nixploy-vs-${entry.slug}`}
						className="block rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-foreground/30 hover:bg-surface"
					>
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<span className="font-display text-lg font-semibold tracking-tight text-foreground">
								Nixploy vs {entry.name}
							</span>
							<span className="text-xs text-muted">{entry.stars} stars</span>
						</div>
						<p className="mt-2 text-sm leading-relaxed text-muted">{entry.headline}</p>
					</Link>
				))}
			</div>

			<section className="mt-12">
				<h2 className="font-display text-xl font-semibold tracking-tight">How these are written</h2>
				<ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted">
					<li>
						· <span className="text-foreground">Everything is sourced.</span> Each claim about
						another project links to the pricing page, licence file or documentation it was read
						from — read, not remembered. Two of them contradicted what a search summary said.
					</li>
					<li>
						· <span className="text-foreground">Dated.</span> Last checked {VERIFIED_ON}. These
						projects ship weekly; if a row is stale,{" "}
						<ProseLink href={`${site.github}/issues`}>open an issue</ProseLink> and it gets fixed.
					</li>
					<li>
						· <span className="text-foreground">No mudslinging.</span> No claims about anybody
						else&apos;s reliability, memory use or security history. Those age badly and are not
						ours to make.
					</li>
					<li>
						· <span className="text-foreground">Every page says where they win.</span> One of these
						three does not paywall anything at all, and the page for it says so in the heading. A
						comparison whose author wins every row is an advertisement.
					</li>
				</ul>
			</section>
		</PageShell>
	);
}
