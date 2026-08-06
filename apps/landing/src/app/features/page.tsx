import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Features — Nixploy",
	description:
		"Applications, compose, databases, domains, monitoring, GitOps, AI copilot, and more.",
};

const groups = [
	{
		title: "Deploy",
		items: [
			"GitHub, GitLab, Bitbucket, Gitea, generic Git, Docker image, drop zip",
			"Nixpacks, Railpack, Dockerfile, buildpacks, static nginx",
			"BuildKit cache for faster rebuilds",
			"Preview deployments for pull requests",
			"One-click rollbacks",
		],
	},
	{
		title: "Operate",
		items: [
			"PostgreSQL, MySQL, MariaDB, MongoDB, Redis with backups",
			"Native Docker Compose / Swarm stacks",
			"Traefik domains + Let's Encrypt TLS",
			"Live logs, metrics history, web terminal",
			"Per-service alert rules, uptime probes, incident timeline",
		],
	},
	{
		title: "Scale your team",
		items: [
			"Organizations with owner / admin / deployer / viewer roles",
			"Resource quotas and white-label branding",
			"Audit log for every mutation",
			"Notifications across Slack, Discord, Telegram, email, and more",
			"REST API, OpenAPI/Swagger, and @nixploy/cli",
		],
	},
	{
		title: "Differentiate",
		items: [
			"Deploy Copilot — explain failed builds, confirm-gated chat actions",
			"GitOps — export/import nixploy.yaml, plan & apply from CLI",
			"Doctor command for Swarm / disk / Docker health",
			"In-app updates from GHCR",
			"86+ one-click templates",
		],
	},
];

export default function FeaturesPage() {
	return (
		<PageShell
			eyebrow="Features"
			title="Everything you need to run production on your own metal."
			description="Nixploy covers the full loop: build, ship, observe, alert, and recover."
		>
			<div className="grid gap-10 sm:grid-cols-2">
				{groups.map((group) => (
					<section key={group.title} className="border-t border-white/10 pt-6">
						<h2 className="mb-4 text-lg font-semibold tracking-tight text-white">{group.title}</h2>
						<ul className="space-y-2.5 text-sm leading-relaxed text-neutral-400">
							{group.items.map((item) => (
								<li key={item} className="flex gap-2">
									<span className="mt-2 size-1 shrink-0 rounded-full bg-white/50" aria-hidden />
									{item}
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
			<p className="mt-14 text-sm text-neutral-500">
				Ready to try it?{" "}
				<Link href="/install" className="text-white underline underline-offset-4">
					Install guide
				</Link>{" "}
				·{" "}
				<a
					href={site.github}
					className="text-white underline underline-offset-4"
					target="_blank"
					rel="noreferrer"
				>
					GitHub
				</a>
			</p>
		</PageShell>
	);
}
