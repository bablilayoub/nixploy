import type { Metadata } from "next";
import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Docs — Nixploy",
	description: "Install Nixploy, connect a domain, and deploy your first service.",
};

export default function DocsPage() {
	return (
		<PageShell
			eyebrow="Docs"
			title="Get from zero to first deploy."
			description="These are the essentials. Deep architecture notes live in the repo under docs/."
		>
			<div className="grid max-w-3xl gap-12 text-[15px] leading-relaxed text-neutral-400">
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">1. Install</h2>
					<p>On a Linux host with root access and a public IP:</p>
					<InstallCommand />
					<p className="text-sm">
						Full options: <ProseLink href="/install">Install page</ProseLink>.
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
						<li>Add an application, attach a domain, hit Deploy.</li>
					</ol>
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">4. CLI</h2>
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
							<ProseLink href={`${site.github}/tree/main/docs`}>Repository docs/</ProseLink>
						</li>
						<li>
							<ProseLink href="/features">Feature overview</ProseLink>
						</li>
					</ul>
				</section>
			</div>
		</PageShell>
	);
}
