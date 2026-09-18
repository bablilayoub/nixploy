import { Check } from "lucide-react";
import Link from "next/link";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container } from "@/components/ui";
import { plans } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

export function PlanCards({ className }: { className?: string }) {
	return (
		<div className={cn("grid gap-4 lg:grid-cols-2", className)}>
			{plans.map((plan, i) => (
				<BlurFade key={plan.name} inView delay={0.06 * i}>
					<div
						className={cn(
							"flex h-full flex-col rounded-2xl border p-6 sm:p-8",
							plan.highlight ? "border-border-strong bg-surface-2" : "border-border bg-surface/60",
						)}
					>
						<div className="flex items-center justify-between">
							<h3 className="font-display text-lg font-semibold text-foreground">{plan.name}</h3>
							{plan.highlight ? (
								<span className="rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-medium text-background">
									Everything included
								</span>
							) : null}
						</div>
						<p className="mt-5 font-display text-4xl font-semibold text-foreground">
							{plan.price}
							{plan.period ? (
								<span className="ml-2 text-sm font-normal text-muted">/ {plan.period}</span>
							) : null}
						</p>
						<p className="mt-3 text-sm text-muted">{plan.blurb}</p>
						{plan.cta.href.startsWith("mailto:") ? (
							<a
								href={plan.cta.href}
								className={cn(
									"mt-6 inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition-colors",
									"border border-border-strong text-foreground hover:bg-surface-3",
								)}
							>
								{plan.cta.label}
							</a>
						) : (
							<Link
								href={plan.cta.href}
								className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-accent-strong"
							>
								{plan.cta.label}
							</Link>
						)}
						<ul className="mt-6 space-y-2.5 text-sm text-muted">
							{plan.items.map((item) => (
								<li key={item} className="flex items-start gap-2.5">
									<Check className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={2} />
									{item}
								</li>
							))}
						</ul>
					</div>
				</BlurFade>
			))}
		</div>
	);
}

export function Pricing() {
	return (
		<section id="pricing" className="py-16 sm:py-24">
			<Container>
				<BlurFade inView>
					<h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						Pricing
					</h2>
					<p className="mt-3 max-w-md text-sm text-muted sm:text-base">
						Free to self-host, no feature gates. You pay for your server, not for a control plane.
					</p>
				</BlurFade>
				<PlanCards className="mt-10" />
				<p className="mt-6 text-center text-xs text-muted-2">
					Apache-2.0. Install on as many servers as you like. No telemetry you cannot disable.
				</p>
			</Container>
		</section>
	);
}
