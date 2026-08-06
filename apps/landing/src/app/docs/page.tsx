import type { Metadata } from "next";
import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description: "Install Nixploy, migrate from Coolify or Dokploy, and deploy your first service.",
};

const repoDoc = (path: string) => `${site.github}/blob/main/docs/${path}`;

export default function DocsPage() {
	return (
		<PageShell
			eyebrow="Docs"
			title="Get from zero to first deploy."
			description="Essentials on this site. Deep guides live in the repo under docs/."
		>
			<div className="grid max-w-3xl gap-12 text-[15px] leading-relaxed text-neutral-400">
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">1. Install</h2>
					<p>On a Linux host with root access and a public IP:</p>
					<InstallCommand />
					<p className="text-sm">
						Full options: <ProseLink href="/install">Install page</ProseLink>
						{" · "}
						<ProseLink href={repoDoc("install.md")}>install.md</ProseLink>
					</p>
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">2. Domain & TLS</h2>
					<p>
						Point an A record for your panel (for example{" "}
						<code className="font-mono text-neutral-200">panel.nixploy.com</code>) at the server,
						then pass <code className="font-mono text-neutral-200">NIXPLOY_DOMAIN</code> and{" "}
						<code className="font-mono text-neutral-200">NIXPLOY_LETSENCRYPT_EMAIL</code> to the
						installer.
					</p>
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">3. First app</h2>
					<ol className="list-decimal space-y-2 pl-5">
						<li>Complete /setup and create your organization.</li>
						<li>Create a project and environment.</li>
						<li>
							Add an application (or pick a template), attach a domain, hit Deploy. Details:{" "}
							<ProseLink href={repoDoc("getting-started.md")}>getting-started.md</ProseLink>
						</li>
					</ol>
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">
						4. Coming from Coolify or Dokploy?
					</h2>
					<p>
						No magic import — recreate services and flip DNS when green. Concept maps and cutover
						checklists:
					</p>
					<ul className="list-disc space-y-2 pl-5">
						<li>
							<ProseLink href={repoDoc("migrate-from-coolify.md")}>Migrate from Coolify</ProseLink>
						</li>
						<li>
							<ProseLink href={repoDoc("migrate-from-dokploy.md")}>Migrate from Dokploy</ProseLink>
						</li>
					</ul>
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">5. CLI</h2>
					<pre className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-4 font-mono text-xs text-neutral-300">
						{`npm i -g @nixploy/cli
nixploy auth login --url https://panel.yourdomain.com --api-key nxlp_...
nixploy doctor
nixploy app list --project-id <id>`}
					</pre>
				</section>
				<section className="space-y-3">
					<h2 className="text-xl font-semibold tracking-tight text-white">More</h2>
					<ul className="list-disc space-y-2 pl-5">
						<li>
							<ProseLink href={`${site.github}/blob/main/docs/README.md`}>
								Full docs index (docs/README.md)
							</ProseLink>
						</li>
						<li>
							<ProseLink href={`${site.github}/blob/main/docs/architecture.md`}>
								Architecture
							</ProseLink>
						</li>
						<li>
							<ProseLink href={`${site.github}/blob/main/docs/domains-traefik.md`}>
								Domains &amp; Traefik
							</ProseLink>
						</li>
						<li>
							<ProseLink href={`${site.github}/tree/main/docs`}>All repository docs/</ProseLink>
						</li>
						<li>
							<ProseLink href="/features">Feature overview</ProseLink>
						</li>
						<li>
							<ProseLink href="/install">Install</ProseLink>
						</li>
					</ul>
				</section>
			</div>
		</PageShell>
	);
}
