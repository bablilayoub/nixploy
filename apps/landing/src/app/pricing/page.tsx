import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PlanCards } from "@/components/plan-cards";
import { faqs } from "@/lib/landing-data";
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

			{/*
			 * The FAQ lives here rather than on the home page: every question on it is
			 * about cost, hosting or what happens when something breaks.
			 */}
			<section className="mt-20 border-t border-border pt-14">
				<h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Questions people ask first
				</h2>
				<dl className="mt-10 grid gap-x-12 gap-y-9 sm:grid-cols-2">
					{faqs.map((item) => (
						<div key={item.q}>
							<dt className="text-[15px] font-semibold tracking-tight text-foreground">{item.q}</dt>
							<dd className="mt-2 text-[14px] leading-relaxed text-muted">{item.a}</dd>
						</div>
					))}
				</dl>
			</section>
		</PageShell>
	);
}
