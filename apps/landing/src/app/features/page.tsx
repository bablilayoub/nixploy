import type { LucideIcon } from "lucide-react";
import {
	Activity,
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

import { LogoMark } from "@/components/logo";
import { PageShell, ProseLink } from "@/components/page-shell";
import { Card, ChipRow, Eyebrow, LearnMore, Panel, Pill, SectionTitle } from "@/components/ui";
import { featureHighlights, featureJumpLinks, featureSections } from "@/lib/features";
import { site } from "@/lib/site";
import { templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: "Features — Nixploy",
	description: `Full feature set for Nixploy: deploy & build, databases, Traefik TLS, monitoring, GitOps, CLI, MCP, Deploy Copilot, backups, Docker control center, and ${templateCount} templates.`,
};

/*
 * The product page in the reference's shape: a centred header, a row of
 * six facts, a chip row of the sections, then one text-beside-card block per
 * section separated by hairlines. Icons are paired with the section ids here
 * so the data file stays free of components; the chip and the section label
 * share one.
 */
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

export default function FeaturesPage() {
	return (
		<PageShell
			icon={<LogoMark className="size-7" />}
			eyebrow="Features"
			title="The full platform, on servers you own"
			description="Nixploy covers the loop operators actually run: build, ship, expose, observe, alert, recover and automate, on Swarm and Traefik you control."
			actions={
				<>
					<Pill href="/docs/install" arrow>
						Install Nixploy
					</Pill>
					<Pill href="/docs" variant="ghost">
						Read the docs
					</Pill>
				</>
			}
		>
			{/* At a glance: six facts in one row from xl up; the values are short enough for a lead size, not a subtitle. */}
			<section aria-labelledby="at-a-glance">
				<h2 id="at-a-glance" className="sr-only">
					At a glance
				</h2>
				<ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
					{featureHighlights.map((item) => (
						<li key={item.label}>
							<Panel className="h-full">
								<Eyebrow>{item.label}</Eyebrow>
								<p className="mt-3 text-lead font-semibold tracking-tight text-balance text-foreground">
									{item.value}
								</p>
							</Panel>
						</li>
					))}
				</ul>
			</section>

			<ChipRow
				className="mt-14"
				label="Feature sections"
				items={featureJumpLinks.map((link) => ({
					...link,
					icon: sectionIcons[link.href.slice(1)],
				}))}
			/>

			{/* Deep sections */}
			<div className="mt-20 flex flex-col gap-24">
				{featureSections.map((section) => {
					const Icon = sectionIcons[section.id];
					const oddCount = section.details.length % 2 === 1;
					return (
						<section
							key={section.id}
							id={section.id}
							aria-labelledby={`${section.id}-title`}
							className="scroll-mt-28 border-t border-border pt-16 lg:pt-24"
						>
							<div className="grid gap-12 lg:grid-cols-12 lg:items-stretch">
								<div className="lg:col-span-5">
									<p className="inline-flex items-center gap-2 text-body font-medium text-accent-strong">
										{Icon ? <Icon className="size-5" aria-hidden /> : null}
										{section.eyebrow}
									</p>
									<h2
										id={`${section.id}-title`}
										className="mt-5 text-title text-balance text-foreground lg:text-headline"
									>
										{section.title}
									</h2>
									<p className="mt-5 text-lead text-muted">{section.lede}</p>
									{section.docHref ? (
										<LearnMore
											href={section.docHref}
											className="mt-6"
											label={`Read the guide: ${section.eyebrow}`}
										>
											Read the guide
										</LearnMore>
									) : null}
									{section.imageSrc ? (
										<ul className="mt-10 flex flex-col gap-5">
											{section.details.map((detail) => (
												<li key={detail.name} className="flex gap-3">
													<Check className="mt-0.5 size-5 shrink-0 text-muted-2" aria-hidden />
													<div>
														<p className="text-body font-medium text-foreground">{detail.name}</p>
														<p className="mt-1 text-small text-muted">{detail.description}</p>
													</div>
												</li>
											))}
										</ul>
									) : null}
								</div>

								<Card className="flex flex-col p-3 lg:col-span-7 lg:min-h-[520px] lg:self-stretch">
									{section.imageSrc ? (
										/*
										 * The whole panel at the card's width is a thumbnail of
										 * unreadable text, so the shot is zoomed to its left two
										 * thirds, anchored top-left, and dissolved into the card.
										 */
										<div className="fade-bottom aspect-[4/3] overflow-hidden rounded-[22px] border border-border bg-background lg:aspect-auto lg:flex-1">
											<Image
												src={section.imageSrc}
												alt={section.imageAlt ?? ""}
												width={3200}
												height={2000}
												sizes="(min-width: 1024px) 990px, 140vw"
												className="h-auto w-[140%] max-w-none"
											/>
										</div>
									) : (
										<ul className="grid flex-1 gap-3 sm:grid-cols-2">
											{section.details.map((detail, index) => (
												<li
													key={detail.name}
													className={
														oddCount && index === section.details.length - 1
															? "sm:col-span-2"
															: undefined
													}
												>
													<Panel tone="surface" className="h-full">
														<p className="text-body font-medium text-foreground">{detail.name}</p>
														<p className="mt-2 text-small text-muted">{detail.description}</p>
													</Panel>
												</li>
											))}
										</ul>
									)}
								</Card>
							</div>
						</section>
					);
				})}
			</div>

			{/* Own the stack */}
			<Card className="mt-24 p-8 sm:p-10">
				<SectionTitle title="Self-hosted without giving up the product surface">
					No usage-based bill for deploys. No black-box edge. Your Swarm, your Traefik, your
					encryption key, with a panel that still has GitOps, MCP, Copilot, previews and instance
					backup.
				</SectionTitle>
				<ul className="mx-auto mt-12 grid max-w-[60rem] gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
					{ownTheStack.map((line) => (
						<li key={line} className="flex items-start gap-3 text-body text-foreground">
							<Check className="mt-0.5 size-5 shrink-0 text-muted-2" aria-hidden />
							{line}
						</li>
					))}
				</ul>
				<p className="mt-10 text-center text-small text-muted">
					Deep guides: <ProseLink href="/docs">Docs</ProseLink>
					{" · "}
					<ProseLink href="/api">API reference</ProseLink>
					{" · "}
					<ProseLink href={site.github}>GitHub</ProseLink>
					{" · "}
					<ProseLink href="/docs/migrate">Migrate</ProseLink>
				</p>
			</Card>
		</PageShell>
	);
}
