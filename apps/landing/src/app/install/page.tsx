import type { Metadata } from "next";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Install — Nixploy",
	description: "One-line installer for Nixploy on any Docker-capable Linux host.",
};

export default function InstallPage() {
	return (
		<PageShell
			eyebrow="Install"
			title="One command. Your PaaS."
			description="The installer installs Docker if needed, initializes Swarm, starts Postgres + Traefik, and boots the dashboard."
		>
			<div className="grid max-w-3xl gap-10 text-[15px] leading-relaxed text-muted">
				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Quick start
					</h2>
					<InstallCommand />
				</section>
				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						With your domain
					</h2>
					<p>Point DNS at the server first, then run:</p>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs whitespace-pre-wrap text-foreground/90">
						{site.installWithDomain}
					</pre>
				</section>
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Useful env overrides
					</h2>
					<p>
						Installer and updater knobs (`NIXPLOY_DOMAIN`, `NIXPLOY_VERSION`,
						`NIXPLOY_UPDATE_TRAEFIK`, pool/log settings, …) are documented in one place:
					</p>
					<p className="text-sm">
						<ProseLink href={`${site.github}/blob/main/docs/install.md`}>docs/install.md</ProseLink>
					</p>
				</section>
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						After install
					</h2>
					<ol className="list-decimal space-y-2 pl-5">
						<li>Open the Setup URL and create the owner account.</li>
						<li>Deploy a whoami image or a template to confirm Traefik.</li>
						<li>Create an API key under Settings → Profile for the CLI.</li>
					</ol>
					<p className="text-sm">
						Full guide:{" "}
						<ProseLink href={`${site.github}/blob/main/docs/install.md`}>docs/install.md</ProseLink>
						{" · "}
						<ProseLink href={`${site.github}/blob/main/docs/getting-started.md`}>
							getting-started.md
						</ProseLink>
					</p>
				</section>
				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Update
					</h2>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs whitespace-pre-wrap text-foreground/90">
						{`curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash`}
					</pre>
				</section>
			</div>
		</PageShell>
	);
}
