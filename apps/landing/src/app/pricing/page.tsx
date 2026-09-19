import { Mail } from "lucide-react";
import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { PlanCards } from "@/components/plan-cards";
import { Panel, Pill, SectionTitle } from "@/components/ui";
import { faqs } from "@/lib/landing-data";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Pricing — Nixploy",
	description: "Self-host Nixploy for free. Forever. Open source.",
};

/*
 * The reference's pricing page: the plan table, a centred note with one pill
 * under it, then the questions. The FAQ lives here rather than on the home
 * page because every question on it is about cost, hosting or what happens
 * when something breaks.
 */
export default function PricingPage() {
	return (
		<PageShell
			eyebrow="Pricing"
			title="Free to self-host. No feature gates."
			description="Nixploy is open source. You pay for your server — not for a control plane."
		>
			<PlanCards />

			<div className="mt-16 flex flex-col items-center text-center">
				<p className="mx-auto max-w-[40rem] text-body text-balance text-muted">
					Apache-2.0. Install on as many servers as you like. No telemetry you cannot disable.
				</p>
				<Pill href={`mailto:${site.email}`} variant="ghost" icon={Mail} external className="mt-6">
					Email {site.email}
				</Pill>
			</div>

			<section className="mt-32">
				<SectionTitle title="Questions people ask first" />
				<dl className="mt-12 grid gap-4 md:grid-cols-2">
					{faqs.map((item) => (
						<Panel key={item.q}>
							<dt className="text-body font-medium text-foreground">{item.q}</dt>
							<dd className="mt-2 text-small text-muted">{item.a}</dd>
						</Panel>
					))}
				</dl>
			</section>
		</PageShell>
	);
}
