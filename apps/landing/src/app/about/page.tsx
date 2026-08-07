import type { Metadata } from "next";

import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "About — Nixploy",
	description: "Why Nixploy exists, what we ship, and the projects that inspired us.",
};

export default function AboutPage() {
	return (
		<PageShell
			eyebrow="About"
			title="Built for people who want their own PaaS."
			description="Nixploy is an open-source, self-hosted platform for deploying applications and databases on Docker Swarm — with Traefik, Git deploys, monitoring, and a CLI that matches the UI."
		>
			<div className="grid max-w-3xl gap-10 text-[15px] leading-relaxed text-muted">
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						The short version
					</h2>
					<p>
						{site.inspiredBy} We learned from those projects, then focused on a sharper product:
						faster rebuilds, AI-assisted failure explain, GitOps via{" "}
						<code className="font-mono text-foreground/90">nixploy.yaml</code>, per-service alerts,
						and day-2 ops that do not require opening the dashboard.
					</p>
				</section>
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						What we optimize for
					</h2>
					<ul className="list-disc space-y-2 pl-5">
						<li>One install on your Linux host — Docker Swarm + Traefik included.</li>
						<li>Projects → environments → services with real multi-tenant roles and quotas.</li>
						<li>Observability that pages you before users notice.</li>
						<li>API + CLI parity so CI and humans use the same surface.</li>
					</ul>
				</section>
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Open source
					</h2>
					<p>
						Code lives on <ProseLink href={site.github}>GitHub</ProseLink>. The marketing site is{" "}
						<ProseLink href={site.url}>nixploy.com</ProseLink>. Reach us at{" "}
						<a
							href={`mailto:${site.email}`}
							className="text-foreground underline decoration-foreground/40 underline-offset-4"
						>
							{site.email}
						</a>
						.
					</p>
				</section>
			</div>
		</PageShell>
	);
}
