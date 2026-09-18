import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
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

function CompareBody({ entry }: { entry: Comparison }) {
	return (
		<PageShell
			wide
			eyebrow="Compare"
			title={`Nixploy vs ${entry.name}`}
			description={entry.headline}
		>
			<p className="rounded-xl border border-border bg-surface/40 p-4 text-sm leading-relaxed text-muted">
				Every claim about {entry.name} below links to where it was read, and was read rather than
				remembered — last checked <span className="text-foreground">{VERIFIED_ON}</span>. These
				projects ship weekly, so if something here is out of date,{" "}
				<ProseLink href={`${site.github}/issues`}>tell us</ProseLink> and it gets fixed. We have not
				included opinions about anybody&apos;s reliability or security history.
			</p>

			<section className="mt-10">
				<h2 className="font-display text-xl font-semibold tracking-tight">What {entry.name} is</h2>
				<p className="mt-3 text-sm leading-relaxed text-muted">{entry.what}</p>
				<dl className="mt-5 grid gap-x-10 sm:grid-cols-2">
					<div className="border-t border-border py-3">
						<dt className="text-xs uppercase tracking-wide text-muted">GitHub stars</dt>
						<dd className="mt-1 text-sm text-foreground">{entry.stars} · Nixploy has 3</dd>
					</div>
					<div className="border-t border-border py-3">
						<dt className="text-xs uppercase tracking-wide text-muted">Licence</dt>
						<dd className="mt-1 text-sm text-foreground">
							<ProseLink href={entry.licenseSource}>{entry.license}</ProseLink>
						</dd>
					</div>
				</dl>
			</section>

			<section className="mt-12">
				<h2 className="font-display text-xl font-semibold tracking-tight">Where they differ</h2>
				<div className="mt-5 space-y-5">
					{entry.facts.map((fact) => (
						<div key={fact.label} className="rounded-xl border border-border bg-surface/30 p-4">
							<p className="text-sm font-medium text-foreground">{fact.label}</p>
							<dl className="mt-3 grid gap-4 sm:grid-cols-2">
								<div>
									<dt className="text-xs uppercase tracking-wide text-muted">{entry.name}</dt>
									<dd className="mt-1 text-sm leading-relaxed text-muted">
										{fact.theirs} <ProseLink href={fact.source}>source</ProseLink>
									</dd>
								</div>
								<div>
									<dt className="text-xs uppercase tracking-wide text-muted">Nixploy</dt>
									<dd className="mt-1 text-sm leading-relaxed text-foreground">{fact.ours}</dd>
								</div>
							</dl>
						</div>
					))}
				</div>
			</section>

			<section className="mt-12 grid gap-8 sm:grid-cols-2">
				<div>
					<h2 className="font-display text-lg font-semibold tracking-tight">
						Pick {entry.name} if
					</h2>
					<ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted">
						{entry.chooseThem.map((reason) => (
							<li key={reason}>· {reason}</li>
						))}
					</ul>
				</div>
				<div>
					<h2 className="font-display text-lg font-semibold tracking-tight">Pick Nixploy if</h2>
					<ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted">
						{entry.chooseUs.map((reason) => (
							<li key={reason}>· {reason}</li>
						))}
					</ul>
				</div>
			</section>

			<section className="mt-14">
				<h2 className="font-display text-xl font-semibold tracking-tight">Try it on one box</h2>
				<p className="mt-3 text-sm text-muted">
					Nixploy installs alongside nothing and takes one command. Point it at a spare VPS before
					you move anything real.
				</p>
				<div className="mt-4">
					<InstallCommand />
				</div>
				<p className="mt-4 text-sm text-muted">
					<Link href="/compare" className="text-foreground underline underline-offset-4">
						Compare the others
					</Link>{" "}
					· <ProseLink href="/docs/migrate">Moving from another panel</ProseLink>
				</p>
			</section>
		</PageShell>
	);
}
