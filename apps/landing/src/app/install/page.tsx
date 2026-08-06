import type { Metadata } from "next";
import { InstallCommand } from "@/components/install-command";
import { PageShell } from "@/components/page-shell";
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
			<div className="grid max-w-3xl gap-10 text-[15px] leading-relaxed text-neutral-400">
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">Quick start</h2>
					<InstallCommand />
				</section>
				<section className="space-y-4">
					<h2 className="text-xl font-semibold tracking-tight text-white">With your domain</h2>
					<p>Point DNS at the server first, then run:</p>
					<pre className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-4 font-mono text-xs whitespace-pre-wrap text-neutral-300">
						{site.installWithDomain}
					</pre>
				</section>
				<section className="space-y-3">
					<h2 className="text-xl font-semibold tracking-tight text-white">Useful env overrides</h2>
					<p>
						Installer and updater knobs (`NIXPLOY_DOMAIN`, `NIXPLOY_VERSION`,
						`NIXPLOY_UPDATE_TRAEFIK`, pool/log settings, …) are documented in one place:
					</p>
					<p className="text-sm">
						<a
							href={`${site.github}/blob/main/docs/install.md`}
							className="text-white underline underline-offset-4"
						>
							docs/install.md
						</a>
					</p>
				</section>
				<section className="space-y-3">
					<h2 className="text-xl font-semibold tracking-tight text-white">After install</h2>
					<ol className="list-decimal space-y-2 pl-5">
						<li>Open the Setup URL and create the owner account.</li>
						<li>Deploy a whoami image or a template to confirm Traefik.</li>
						<li>Create an API key under Settings → Profile for the CLI.</li>
					</ol>
					<p className="text-sm">
						Full guide in the repo:{" "}
						<a
							href={`${site.github}/blob/main/docs/install.md`}
							className="text-white underline underline-offset-4"
						>
							docs/install.md
						</a>
						{" · "}
						<a
							href={`${site.github}/blob/main/docs/getting-started.md`}
							className="text-white underline underline-offset-4"
						>
							getting-started.md
						</a>
					</p>
				</section>
				<section className="space-y-3">
					<h2 className="text-xl font-semibold tracking-tight text-white">Update</h2>
					<pre className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-4 font-mono text-xs whitespace-pre-wrap text-neutral-300">
						{`curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash`}
					</pre>
				</section>
			</div>
		</PageShell>
	);
}
