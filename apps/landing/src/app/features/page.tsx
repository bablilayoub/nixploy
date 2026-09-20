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
			<section aria-labelledby="at-a-glance">
				<h2 id="at-a-glance" className="sr-only">
					At a glance
				</h2>
				<ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
					{featureHighlights.map((item) => (
						<li key={item.label}>
							<Card className="h-full p-5">
								<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
									{item.label}
								</p>
								<p className="mt-3 text-lg font-semibold tracking-tight text-balance">
									{item.value}
								</p>
							</Card>
						</li>
					))}
				</ul>
			</section>

			<nav aria-label="Feature sections" className="mt-12 flex flex-wrap gap-2">
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

			<div className="mt-16 flex flex-col gap-20">
				{featureSections.map((section) => {
					const Icon = sectionIcons[section.id];
					return (
						<section
							key={section.id}
							id={section.id}
							aria-labelledby={`${section.id}-title`}
							className="scroll-mt-28 border-t pt-14"
						>
							<div className="grid gap-10 lg:grid-cols-12 lg:items-start">
								<div className="lg:col-span-5">
									<p className="inline-flex items-center gap-2 font-medium text-primary">
										{Icon ? <Icon className="size-5" aria-hidden /> : null}
										{section.eyebrow}
									</p>
									<h2
										id={`${section.id}-title`}
										className="mt-4 text-3xl font-semibold tracking-tight text-balance lg:text-4xl"
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
									{section.imageSrc ? (
										<ul className="mt-8 flex flex-col gap-5">
											{section.details.map((detail) => (
												<li key={detail.name} className="flex gap-3">
													<Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
													<div>
														<p className="font-medium">{detail.name}</p>
														<p className="mt-1 text-sm text-muted-foreground">
															{detail.description}
														</p>
													</div>
												</li>
											))}
										</ul>
									) : null}
								</div>

								<div className="lg:col-span-7">
									{section.imageSrc ? (
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
									) : (
										<ul className="grid gap-3 sm:grid-cols-2">
											{section.details.map((detail, index) => (
												<li
													key={detail.name}
													// An odd number of cells leaves the last one alone in a
													// two-column grid; let it take the row.
													className={
														section.details.length % 2 === 1 && index === section.details.length - 1
															? "sm:col-span-2"
															: undefined
													}
												>
													<Card className="h-full p-5">
														<p className="font-medium">{detail.name}</p>
														<p className="mt-2 text-sm text-muted-foreground">
															{detail.description}
														</p>
													</Card>
												</li>
											))}
										</ul>
									)}
								</div>
							</div>
						</section>
					);
				})}
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
