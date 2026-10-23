import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageFrame, ProseLink } from "@/components/page-frame";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
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

const Label = ({ children }: { children: React.ReactNode }) => (
	<dt className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
		{children}
	</dt>
);

/*
 * Every word about the other project comes from lib/compare.ts and carries a
 * source; this file only lays it out.
 */
function CompareBody({ entry }: { entry: Comparison }) {
	return (
		<PageFrame eyebrow="Compare" title={`Nixploy vs ${entry.name}`} description={entry.headline}>
			<Card className="mx-auto max-w-3xl p-6 text-center text-sm text-muted-foreground">
				Every claim about {entry.name} below links to where it was read, and was read rather than
				remembered — last checked <span className="text-foreground">{VERIFIED_ON}</span>. These
				projects ship weekly, so if something here is out of date,{" "}
				<ProseLink href={`${site.github}/issues`}>tell us</ProseLink> and it gets fixed. We have not
				included opinions about anybody&apos;s reliability or security history.
			</Card>

			<div className="mt-12 grid gap-4 lg:grid-cols-12">
				<Card className="lg:col-span-7">
					<CardHeader>
						<CardTitle className="text-2xl">What {entry.name} is</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground">{entry.what}</p>
					</CardContent>
				</Card>
				<Card className="lg:col-span-5">
					<CardContent>
						<dl className="flex flex-col gap-5">
							<div>
								<Label>GitHub stars</Label>
								<dd className="mt-2">{entry.stars} · Nixploy has 3</dd>
							</div>
							<div>
								<Label>Licence</Label>
								<dd className="mt-2">
									<ProseLink href={entry.licenseSource}>{entry.license}</ProseLink>
								</dd>
							</div>
						</dl>
					</CardContent>
				</Card>
			</div>

			<section className="mt-20">
				<h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">Where they differ</h2>
				<div className="mt-8 flex flex-col gap-4">
					{entry.facts.map((fact) => (
						<Card key={fact.label} className="p-6">
							<h3 className="font-medium">{fact.label}</h3>
							<dl className="mt-4 grid gap-6 sm:grid-cols-2">
								<div>
									<Label>{entry.name}</Label>
									<dd className="mt-2 text-sm text-muted-foreground">
										{fact.theirs} <ProseLink href={fact.source}>source</ProseLink>
									</dd>
								</div>
								<div>
									<Label>Nixploy</Label>
									<dd className="mt-2 text-sm">{fact.ours}</dd>
								</div>
							</dl>
						</Card>
					))}
				</div>
			</section>

			<div className="mt-12 grid gap-4 md:grid-cols-2">
				{[
					{ title: `Pick ${entry.name} if`, reasons: entry.chooseThem },
					{ title: "Pick Nixploy if", reasons: entry.chooseUs },
				].map((column) => (
					<Card key={column.title}>
						<CardHeader>
							<CardTitle className="text-2xl">{column.title}</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col gap-3">
								{column.reasons.map((reason) => (
									<li key={reason} className="flex items-start gap-3">
										<Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
										{reason}
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				))}
			</div>

			<Card className="mt-12">
				<CardHeader>
					<CardTitle className="text-2xl">Try it on one box</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="max-w-3xl text-muted-foreground">
						Nixploy installs alongside nothing and takes one command. Point it at a spare VPS before
						you move anything real.
					</p>
					<div className="mt-6 max-w-3xl">
						<CodeBlock language="bash" filename="install.sh" code={site.install} />
					</div>
					<p className="mt-6 text-sm text-muted-foreground">
						<ProseLink href="/compare">Compare the others</ProseLink> ·{" "}
						<ProseLink href="/docs/migrate">Moving from another panel</ProseLink>
					</p>
				</CardContent>
			</Card>
		</PageFrame>
	);
}
