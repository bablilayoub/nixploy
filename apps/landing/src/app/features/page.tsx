import type { LucideIcon } from "lucide-react";
import {
	Activity,
	ArrowRight,
	Check,
	Database,
	Globe,
	Rocket,
	Server,
	Sparkles,
	Users,
	Workflow,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PageFrame, ProseLink } from "@/components/page-frame";
import { SectionRail } from "@/components/section-rail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { featureHighlights, featureJumpLinks, featureSections } from "@/lib/features";
import { site } from "@/lib/site";
import { templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: "Features — Nixploy",
	description: `Full feature set for Nixploy: deploy & build, databases, Traefik TLS, monitoring, GitOps, CLI, MCP, Deploy Copilot, backups, Docker control center, and ${templateCount} templates.`,
};

const sectionIcons: Record<string, LucideIcon> = {
	deploy: Rocket,
	data: Database,
	edge: Globe,
	observe: Activity,
	team: Users,
	automate: Workflow,
	infra: Server,
	ai: Sparkles,
};

const ownTheStack = [
	"Apache-2.0 · self-host forever",
	"Single Node process + Postgres + Traefik",
	"Org tenancy from day one",
	"Encrypted secrets at rest",
	"OpenAPI on your panel, not a SaaS gateway",
	"Migrate from another panel with a concept map",
];

const railItems = featureJumpLinks.map((link) => ({
	id: link.href.slice(1),
	label: link.label,
}));

export default function FeaturesPage() {
	return (
		<PageFrame
			eyebrow="Features"
			title="The full platform, on servers you own"
			description="Nixploy covers the loop operators actually run: build, ship, expose, observe, alert, recover and automate, on Swarm and Traefik you control."
			actions={
				<>
					<Button asChild size="lg" className="rounded-lg">
						<Link href="/docs/install">
							Install Nixploy
							<ArrowRight className="size-4" />
						</Link>
					</Button>
					<Button asChild variant="outline" size="lg" className="rounded-lg">
						<Link href="/docs">Read the docs</Link>
					</Button>
				</>
			}
		>
			{/* One panel with cells rather than six cards: these are six facts of
			    the same kind, and six bordered boxes made them look like six
			    features. */}
			<section aria-labelledby="at-a-glance">
				<h2 id="at-a-glance" className="sr-only">
					At a glance
				</h2>
				<ul className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border bg-card/40 sm:grid-cols-3 sm:divide-x xl:grid-cols-6">
					{featureHighlights.map((item) => (
						<li key={item.label} className="border-b p-5 last:border-b-0 sm:border-b-0">
							<p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
								{item.label}
							</p>
							<p className="mt-2 font-semibold tracking-tight text-balance">{item.value}</p>
						</li>
					))}
				</ul>
			</section>

			{/* Rail on the left from `lg`, chips above the content below it. The
			    page is eight sections long; without a table of contents the only
			    way to reach "Automate" is to scroll past everything else. */}
			<div className="mt-14 gap-12 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
				<SectionRail items={railItems} className="sticky top-24 hidden self-start lg:block" />

				<nav aria-label="Feature sections" className="flex flex-wrap gap-2 lg:hidden">
					{featureJumpLinks.map((link) => {
						const Icon = sectionIcons[link.href.slice(1)];
						return (
							<Button key={link.href} asChild variant="outline" size="sm" className="rounded-full">
								<a href={link.href}>
									{Icon ? <Icon className="size-4" aria-hidden /> : null}
									{link.label}
								</a>
							</Button>
						);
					})}
				</nav>

				<div className="mt-10 flex flex-col gap-16 lg:mt-0">
					{featureSections.map((section, index) => {
						const Icon = sectionIcons[section.id];
						return (
							<section
								key={section.id}
								id={section.id}
								aria-labelledby={`${section.id}-title`}
								className="scroll-mt-28 border-t pt-10 first:border-t-0 first:pt-0"
							>
								<div className="grid gap-10 lg:grid-cols-12 lg:items-start">
									<div className="lg:col-span-5">
										<p className="inline-flex items-center gap-2 text-sm font-medium">
											<span className="font-mono text-xs text-muted-foreground">
												{String(index + 1).padStart(2, "0")}
											</span>
											{Icon ? <Icon className="size-4" aria-hidden /> : null}
											{section.eyebrow}
										</p>
										<h2
											id={`${section.id}-title`}
											className="mt-3 text-2xl font-semibold tracking-tight text-balance lg:text-3xl"
										>
											{section.title}
										</h2>
										<p className="mt-4 text-lg text-muted-foreground">{section.lede}</p>
										{section.docHref ? (
											<Button asChild variant="link" className="mt-4 px-0">
												<Link href={section.docHref}>
													Read the guide
													<ArrowRight className="size-4" />
												</Link>
											</Button>
										) : null}
									</div>

									{section.imageSrc ? (
										<div className="lg:col-span-7">
											<Card className="overflow-hidden p-2">
												<div className="overflow-hidden rounded-lg border [mask-image:linear-gradient(to_bottom,#000_60%,transparent)]">
													<Image
														src={section.imageSrc}
														alt={section.imageAlt ?? ""}
														width={3200}
														height={2000}
														sizes="(min-width: 1024px) 720px, 100vw"
														className="h-auto w-[140%] max-w-none"
													/>
												</div>
											</Card>
										</div>
									) : null}
								</div>

								{/* The detail cards run the full width under the row, whether or
							    not the section has a screenshot. Beside it, they left half of
							    every image section empty. */}
								<ul className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
									{section.details.map((detail) => (
										<li key={detail.name}>
											<Card className="h-full p-5">
												<p className="flex items-start gap-2 font-medium">
													<Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
													{detail.name}
												</p>
												<p className="mt-2 text-sm text-muted-foreground">{detail.description}</p>
											</Card>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			</div>

			<Card className="mt-20">
				<CardContent className="py-4">
					<h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
						Self-hosted without giving up the product surface
					</h2>
					<p className="mt-4 max-w-3xl text-muted-foreground">
						No usage-based bill for deploys. No black-box edge. Your Swarm, your Traefik, your
						encryption key, with a panel that still has GitOps, MCP, Copilot, previews and instance
						backup.
					</p>
					<ul className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
						{ownTheStack.map((line) => (
							<li key={line} className="flex items-start gap-3">
								<Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
								{line}
							</li>
						))}
					</ul>
					<p className="mt-8 text-sm text-muted-foreground">
						Deep guides: <ProseLink href="/docs">Docs</ProseLink>
						{" · "}
						<ProseLink href="/api">API reference</ProseLink>
						{" · "}
						<ProseLink href={site.github}>GitHub</ProseLink>
						{" · "}
						<ProseLink href="/docs/migrate">Migrate</ProseLink>
					</p>
				</CardContent>
			</Card>
		</PageFrame>
	);
}
