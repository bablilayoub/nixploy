import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Pricing — Nixploy",
	description: "Self-host Nixploy for free. Forever. Open source.",
};

export default function PricingPage() {
	return (
		<PageShell
			eyebrow="Pricing"
			title="Free to self-host. No feature gates."
			description="Nixploy is open source. You pay for your VPS — not for our control plane."
		>
			<div className="relative max-w-xl overflow-hidden rounded-xl border border-border bg-surface p-8">
				<p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">Self-hosted</p>
				<p className="mt-3 font-display text-5xl font-semibold tracking-tight text-foreground">
					$0
				</p>
				<p className="mt-2 text-sm text-muted">
					Unlimited projects, services, and servers on hardware you own.
				</p>
				<ul className="mt-6 space-y-2 text-sm text-muted">
					<li className="flex gap-2">
						<span className="text-muted">✓</span> Full dashboard, API, CLI
					</li>
					<li className="flex gap-2">
						<span className="text-muted">✓</span> Deploy Copilot (bring your own LLM key)
					</li>
					<li className="flex gap-2">
						<span className="text-muted">✓</span> GitOps, alerts, uptime, templates
					</li>
					<li className="flex gap-2">
						<span className="text-muted">✓</span> No telemetry you cannot disable
					</li>
				</ul>
				<div className="mt-8 flex flex-wrap gap-3">
					<Link
						href="/install"
						className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
					>
						Install now
					</Link>
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						className="rounded-md border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-foreground/40 hover:text-foreground"
					>
						View source
					</a>
				</div>
			</div>
			<p className="mt-10 max-w-2xl text-sm text-muted">
				Want managed hosting later?{" "}
				<a
					href={`mailto:${site.email}`}
					className="text-foreground underline decoration-foreground/40 underline-offset-4"
				>
					{site.email}
				</a>
			</p>
		</PageShell>
	);
}
