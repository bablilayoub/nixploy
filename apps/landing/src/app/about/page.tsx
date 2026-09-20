import type { Metadata } from "next";

import { PageFrame, ProseLink } from "@/components/page-frame";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "About — Nixploy",
	description: "Why Nixploy exists, what we ship, and the projects that inspired us.",
};

export default function AboutPage() {
	return (
		<PageFrame
			width="prose"
			eyebrow="About"
			title="Built for people who want their own PaaS."
			description="An open-source, self-hosted platform for deploying applications and databases on Docker Swarm — with Traefik, Git deploys, monitoring, and a CLI that matches the UI."
		>
			<div className="prose prose-invert max-w-none prose-headings:font-display prose-a:text-primary">
				<h2>The short version</h2>
				<p>
					{site.inspiredBy} We learned from those projects, then focused on a sharper product:
					faster rebuilds, AI-assisted failure explain, GitOps via <code>nixploy.yaml</code>,
					per-service alerts, and day-2 ops that do not require opening the dashboard.
				</p>
				<h2>What we optimize for</h2>
				<ul>
					<li>One install on your Linux host — Docker Swarm + Traefik included.</li>
					<li>Projects → environments → services with real multi-tenant roles and quotas.</li>
					<li>Observability that pages you before users notice.</li>
					<li>API + CLI parity so CI and humans use the same surface.</li>
				</ul>
				<h2>Open source</h2>
				<p>
					Code lives on <ProseLink href={site.github}>GitHub</ProseLink>. The marketing site is{" "}
					<ProseLink href={site.url}>nixploy.com</ProseLink>. Reach us at{" "}
					<a href={`mailto:${site.email}`}>{site.email}</a>.
				</p>
			</div>
		</PageFrame>
	);
}
