import { Check } from "lucide-react";
import Link from "next/link";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Card } from "@/components/ui";
import { plans } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

export function PlanCards({ className }: { className?: string }) {
	return (
		<div className={cn("grid gap-4 lg:grid-cols-2", className)}>
			{plans.map((plan, i) => (
				<BlurFade key={plan.name} inView delay={0.06 * i}>
					<Card className={cn("flex h-full flex-col p-7 sm:p-8", plan.highlight && "bg-surface-2")}>
						<div className="flex items-center justify-between gap-3">
							<h3 className="font-display text-base font-semibold tracking-tight text-foreground">
								{plan.name}
							</h3>
							{plan.highlight ? (
								<span className="rounded-full border border-border-strong px-2.5 py-0.5 text-[11px] text-muted">
									Everything included
								</span>
							) : null}
						</div>

						<p className="mt-6 font-display text-[2.5rem] leading-none font-semibold tracking-tight text-foreground">
							{plan.price}
							{plan.period ? (
								<span className="ml-2 text-sm font-normal text-muted-2">/ {plan.period}</span>
							) : null}
						</p>
						<p className="mt-4 text-[14px] leading-relaxed text-muted">{plan.blurb}</p>

						<ul className="mt-7 grow space-y-3">
							{plan.items.map((item) => (
								<li key={item} className="flex items-start gap-3 text-[14px] text-muted">
									<Check className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={2.2} />
									{item}
								</li>
							))}
						</ul>

						{plan.cta.href.startsWith("mailto:") ? (
							<a
								href={plan.cta.href}
								className="mt-8 inline-flex h-11 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface-3"
							>
								{plan.cta.label}
							</a>
						) : (
							<Link
								href={plan.cta.href}
								className="mt-8 inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
							>
								{plan.cta.label}
							</Link>
						)}
					</Card>
				</BlurFade>
			))}
		</div>
	);
}
