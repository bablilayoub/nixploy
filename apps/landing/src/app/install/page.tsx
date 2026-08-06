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
					<ul className="list-disc space-y-2 pl-5 font-mono text-xs text-neutral-300">
						<li>NIXPLOY_DOMAIN</li>
						<li>NIXPLOY_LETSENCRYPT_EMAIL</li>
						<li>NIXPLOY_VERSION / NIXPLOY_IMAGE</li>
						<li>NIXPLOY_PORT / NIXPLOY_CONFIG_DIR</li>
						<li>NIXPLOY_BUILD_FROM_SOURCE=1</li>
					</ul>
				</section>
			</div>
		</PageShell>
	);
}
