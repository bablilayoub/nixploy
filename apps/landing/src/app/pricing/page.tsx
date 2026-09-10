import type { Metadata } from "next";

import { PlanCards } from "@/components/home/pricing";
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
			description="Nixploy is open source. You pay for your server — not for a control plane."
			wide
		>
			<PlanCards />
			<p className="mt-10 max-w-2xl text-sm text-muted">
				Apache-2.0. Install on as many servers as you like. No telemetry you cannot disable.
				Questions?{" "}
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
