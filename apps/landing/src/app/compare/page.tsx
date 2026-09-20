import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame, ProseLink } from "@/components/page-frame";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { comparisons, VERIFIED_ON } from "@/lib/compare";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Nixploy compared to the other self-hosted PaaS options",
	description:
		"Sourced, dated comparisons between Nixploy and Dokploy, Coolify and CapRover. Every claim about another project links to where it was read, including the ones where they win.",
	alternates: { canonical: `${site.url}/compare` },
};

const notes = [
	{
		title: "Everything is sourced",
		text: "Each claim about another project links to the pricing page, licence file or documentation it was read from — read, not remembered. Two of them contradicted what a search summary said.",
	},
	{
		title: "No mudslinging",
		text: "No claims about anybody else's reliability, memory use or security history. Those age badly and are not ours to make.",
	},
	{
		title: "Every page says where they win",
		text: "One of these three does not paywall anything at all, and the page for it says so in the heading. A comparison whose author wins every row is an advertisement.",
	},
] as const;

export default function ComparePage() {
	return (
		<PageFrame
			eyebrow="Compare"
			title="How Nixploy compares"
			description="This category is crowded, and three of these projects are older and larger than this one. Here is where each actually differs — sourced, dated, and including the rows where they win."
		>
			<div className="grid gap-4 lg:grid-cols-3">
				{comparisons.map((entry) => (
					<Link
						key={entry.slug}
						href={`/nixploy-vs-${entry.slug}`}
						aria-label={`Nixploy vs ${entry.name}`}
						className="group block h-full"
					>
						<Card className="h-full transition-colors hover:border-primary/40">
							<CardHeader>
								<CardTitle className="text-2xl">Nixploy vs {entry.name}</CardTitle>
								<p className="font-mono text-xs text-muted-foreground">{entry.stars} stars</p>
							</CardHeader>
							<CardContent className="flex h-full flex-col">
								<p className="flex-1 text-muted-foreground">{entry.headline}</p>
								<span className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-primary">
									Read the comparison
									<ChevronRight
										className="size-4 transition-transform group-hover:translate-x-0.5"
										aria-hidden
									/>
								</span>
							</CardContent>
						</Card>
					</Link>
				))}
			</div>

			<section className="mt-24">
				<h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">How these are written</h2>
				<div className="mt-8 grid gap-4 md:grid-cols-2">
					{notes.map((note) => (
						<Card key={note.title} className="p-6">
							<h3 className="font-medium">{note.title}</h3>
							<p className="mt-2 text-sm text-muted-foreground">{note.text}</p>
						</Card>
					))}
					<Card className="p-6">
						<h3 className="font-medium">Dated</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							Last checked {VERIFIED_ON}. These projects ship weekly; if a row is stale,{" "}
							<ProseLink href={`${site.github}/issues`}>open an issue</ProseLink> and it gets fixed.
						</p>
					</Card>
				</div>
			</section>
		</PageFrame>
	);
}
