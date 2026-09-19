import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { Card, Panel, SectionTitle } from "@/components/ui";
import { type Comparison, comparisonSlugs, findComparison, VERIFIED_ON } from "@/lib/compare";
import { site } from "@/lib/site";

export function generateStaticParams() {
	return comparisonSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const entry = findComparison(slug);
	if (!entry) return { title: "Compare — Nixploy" };
	return {
		title: `Nixploy vs ${entry.name}`,
		description: `${entry.headline} A sourced comparison of two self-hosted PaaS options — every claim about ${entry.name} links to where it was read, last checked ${VERIFIED_ON}.`,
		alternates: { canonical: `${site.url}/nixploy-vs-${slug}` },
	};
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const entry = findComparison(slug);
	if (!entry) notFound();
	return <CompareBody entry={entry} />;
}

/*
 * Every word about the other project comes from lib/compare.ts and carries a
 * source; this file only lays it out. The two columns of "Where they differ"
 * are deliberately the same size and weight — theirs is muted only so the
 * source link reads.
 */
function CompareBody({ entry }: { entry: Comparison }) {
	return (
		<PageShell eyebrow="Compare" title={`Nixploy vs ${entry.name}`} description={entry.headline}>
			<Panel className="mx-auto max-w-[44rem] text-center text-small text-muted">
				Every claim about {entry.name} below links to where it was read, and was read rather than
				remembered — last checked <span className="text-foreground">{VERIFIED_ON}</span>. These
				projects ship weekly, so if something here is out of date,{" "}
				<ProseLink href={`${site.github}/issues`}>tell us</ProseLink> and it gets fixed. We have not
				included opinions about anybody&apos;s reliability or security history.
			</Panel>

			<div className="mt-16 grid gap-4 lg:grid-cols-12">
				<Card className="p-8 sm:p-10 lg:col-span-7">
					<h2 className="text-title text-foreground">What {entry.name} is</h2>
					<p className="mt-5 text-body text-muted">{entry.what}</p>
				</Card>
				<Card className="p-8 sm:p-10 lg:col-span-5">
					<dl className="flex flex-col gap-4">
						<Panel tone="surface" className="p-5">
							<dt className="eyebrow">GitHub stars</dt>
							<dd className="mt-2 text-body text-foreground">{entry.stars} · Nixploy has 3</dd>
						</Panel>
						<Panel tone="surface" className="p-5">
							<dt className="eyebrow">Licence</dt>
							<dd className="mt-2 text-body text-foreground">
								<ProseLink href={entry.licenseSource}>{entry.license}</ProseLink>
							</dd>
						</Panel>
					</dl>
				</Card>
			</div>

			<section className="mt-32">
				<SectionTitle title="Where they differ" />
				<div className="mt-12 flex flex-col gap-4">
					{entry.facts.map((fact) => (
						<Panel key={fact.label}>
							<h3 className="text-body font-medium text-foreground">{fact.label}</h3>
							<dl className="mt-4 grid gap-6 sm:grid-cols-2">
								<div>
									<dt className="eyebrow">{entry.name}</dt>
									<dd className="mt-2 text-small text-muted">
										{fact.theirs} <ProseLink href={fact.source}>source</ProseLink>
									</dd>
								</div>
								<div>
									<dt className="eyebrow">Nixploy</dt>
									<dd className="mt-2 text-small text-foreground">{fact.ours}</dd>
								</div>
							</dl>
						</Panel>
					))}
				</div>
			</section>

			<div className="mt-16 grid gap-4 md:grid-cols-2">
				<Card className="p-8 sm:p-10">
					<h2 className="text-title text-foreground">Pick {entry.name} if</h2>
					<ul className="mt-6 flex flex-col gap-3">
						{entry.chooseThem.map((reason) => (
							<li key={reason} className="flex items-start gap-3 text-body text-foreground">
								<Check className="mt-1 size-4 shrink-0 text-muted-2" aria-hidden />
								{reason}
							</li>
						))}
					</ul>
				</Card>
				<Card className="p-8 sm:p-10">
					<h2 className="text-title text-foreground">Pick Nixploy if</h2>
					<ul className="mt-6 flex flex-col gap-3">
						{entry.chooseUs.map((reason) => (
							<li key={reason} className="flex items-start gap-3 text-body text-foreground">
								<Check className="mt-1 size-4 shrink-0 text-muted-2" aria-hidden />
								{reason}
							</li>
						))}
					</ul>
				</Card>
			</div>

			<Card className="mt-16 p-8 sm:p-10">
				<h2 className="text-title text-foreground">Try it on one box</h2>
				<p className="mt-4 max-w-[46rem] text-body text-muted">
					Nixploy installs alongside nothing and takes one command. Point it at a spare VPS before
					you move anything real.
				</p>
				<InstallCommand className="mt-6 max-w-[46rem]" />
				<p className="mt-6 text-small text-muted">
					<ProseLink href="/compare">Compare the others</ProseLink> ·{" "}
					<ProseLink href="/docs/migrate">Moving from another panel</ProseLink>
				</p>
			</Card>
		</PageShell>
	);
}
