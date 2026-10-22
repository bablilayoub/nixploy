import type { Metadata } from "next";

import { DeploymentPath } from "@/components/deployment-path";
import { PageFrame, ProseLink } from "@/components/page-frame";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "About — Nixploy",
	description: "Why Nixploy exists and how its deployment platform is built.",
};

export default function AboutPage() {
	return (
		<PageFrame
			eyebrow="About"
			title="Good software deserves its own home."
			description="An open-source, self-hosted platform for deploying applications and databases on Docker Swarm — with Traefik, Git deploys, monitoring, and a CLI that matches the UI."
		>
			<DeploymentPath compact />
			<div className="legal-copy mx-auto mt-16 max-w-3xl">
				<h2>The short version</h2>
				<p>
					Nixploy brings builds, deployments and everyday operations into one workspace on Docker
					Swarm. The platform includes AI-assisted failure explanations, GitOps via{" "}
					<code>nixploy.yaml</code>, per-service alerts, and day-2 ops that do not require opening
					the dashboard.
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
