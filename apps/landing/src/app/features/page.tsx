import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { ProseLink } from "@/components/page-shell";
import { featureHighlights, featureJumpLinks, featureSections } from "@/lib/features";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Features — Nixploy",
	description:
		"Full feature set for Nixploy: deploy & build, databases, Traefik TLS, monitoring, GitOps, CLI, MCP, Deploy Copilot, backups, Docker control center, and 86+ templates.",
};

export default function FeaturesPage() {
	return (
		<div className="relative flex min-h-screen flex-col bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<Navbar />
			<main className="relative flex-1">
				{/* Hero */}
				<header className="border-b border-border">
					<div className="mx-auto max-w-6xl px-5 pt-28 pb-14 sm:px-6 sm:pt-36 sm:pb-16">
						<p className="eyebrow">Features</p>
						<h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
							The full platform — not a thin wrapper around Docker.
						</h1>
						<p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
							Nixploy covers the loop operators actually run: build, ship, expose, observe, alert,
							recover, and automate — on Swarm and Traefik you control.
						</p>
						<nav
							aria-label="Feature sections"
							className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-6 text-sm"
						>
							{featureJumpLinks.map((link) => (
								<a
									key={link.href}
									href={link.href}
									className="text-muted transition-colors hover:text-foreground"
								>
									{link.label}
								</a>
							))}
						</nav>
					</div>
				</header>

				{/* At a glance */}
				<section className="border-b border-border" aria-labelledby="at-a-glance">
					<div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-14">
						<h2 id="at-a-glance" className="sr-only">
							At a glance
						</h2>
						<ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{featureHighlights.map((item) => (
								<li key={item.label} className="border-l border-border pl-4">
									<p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
										{item.label}
									</p>
									<p className="mt-1.5 font-display text-lg font-semibold tracking-tight text-foreground">
										{item.value}
									</p>
								</li>
							))}
						</ul>
					</div>
				</section>

				{/* Deep sections */}
				{featureSections.map((section) => (
					<section
						key={section.id}
						id={section.id}
						className="scroll-mt-24 border-b border-border"
						aria-labelledby={`${section.id}-title`}
					>
						<div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
							<div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
								<div className={section.imageSrc ? "lg:col-span-5" : "lg:col-span-4"}>
									<p className="eyebrow">{section.eyebrow}</p>
									<h2
										id={`${section.id}-title`}
										className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
									>
										{section.title}
									</h2>
									<p className="mt-4 text-[15px] leading-relaxed text-muted">{section.lede}</p>
									{section.docHref ? (
										<p className="mt-5 text-sm">
											<ProseLink href={section.docHref}>Read the guide →</ProseLink>
										</p>
									) : null}
									{section.imageSrc ? (
										<figure className="mt-8 overflow-hidden rounded-lg border border-border bg-surface lg:hidden">
											<Image
												src={section.imageSrc}
												alt={section.imageAlt ?? ""}
												width={1280}
												height={800}
												className="h-auto w-full"
											/>
										</figure>
									) : null}
								</div>

								<div className={section.imageSrc ? "lg:col-span-7" : "lg:col-span-8"}>
									{section.imageSrc ? (
										<figure className="mb-10 hidden overflow-hidden rounded-lg border border-border bg-surface lg:block">
											<Image
												src={section.imageSrc}
												alt={section.imageAlt ?? ""}
												width={1280}
												height={800}
												className="h-auto w-full"
											/>
										</figure>
									) : null}
									<ul className="grid gap-6 sm:grid-cols-2">
										{section.details.map((detail) => (
											<li key={detail.name} className="border-t border-border pt-4">
												<h3 className="font-display text-sm font-semibold tracking-tight text-foreground">
													{detail.name}
												</h3>
												<p className="mt-1.5 text-sm leading-relaxed text-muted">
													{detail.description}
												</p>
											</li>
										))}
									</ul>
								</div>
							</div>
						</div>
					</section>
				))}

				{/* Compare / close */}
				<section className="border-b border-border" aria-labelledby="why-nixploy">
					<div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
						<div className="max-w-2xl">
							<p className="eyebrow">Own the stack</p>
							<h2
								id="why-nixploy"
								className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
							>
								Self-hosted without giving up the product surface.
							</h2>
							<p className="mt-4 text-[15px] leading-relaxed text-muted">
								No usage-based bill for deploys. No black-box edge. Your Swarm, your Traefik, your
								encryption key — with a panel that still has GitOps, MCP, Copilot, previews, and
								instance backup.
							</p>
						</div>
						<ul className="mt-10 grid gap-4 text-sm text-muted sm:grid-cols-2 lg:grid-cols-3">
							{[
								"Apache-2.0 · self-host forever",
								"Single Node process + Postgres + Traefik",
								"Org tenancy from day one",
								"Encrypted secrets at rest",
								"OpenAPI on your panel, not a SaaS gateway",
								"Migrate from another panel with a concept map",
							].map((line) => (
								<li key={line} className="flex gap-2 border-t border-border pt-3">
									<span className="text-foreground" aria-hidden>
										—
									</span>
									{line}
								</li>
							))}
						</ul>
						<p className="mt-10 text-sm text-muted">
							Deep guides: <ProseLink href="/docs">Docs</ProseLink>
							{" · "}
							<ProseLink href="/api">API reference</ProseLink>
							{" · "}
							<a
								href={site.github}
								target="_blank"
								rel="noreferrer"
								className="text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground"
							>
								GitHub
							</a>
							{" · "}
							<ProseLink href="/docs/migrate">Migrate</ProseLink>
						</p>
					</div>
				</section>

				{/* CTA */}
				<section className="relative">
					<div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-6 sm:py-20">
						<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
							Install Nixploy on your metal
						</h2>
						<p className="mx-auto mt-3 max-w-lg text-muted">
							One command. Docker Swarm, Traefik, and the panel — yours.
						</p>
						<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Link
								href="/docs/install"
								className="inline-flex h-11 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
							>
								Install guide
							</Link>
							<a
								href={site.github}
								target="_blank"
								rel="noreferrer"
								className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
							>
								Star on GitHub
							</a>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
