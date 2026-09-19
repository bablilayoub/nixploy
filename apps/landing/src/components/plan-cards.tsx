import { Check } from "lucide-react";

import { Card, Eyebrow, Pill } from "@/components/ui";
import { plans } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

/*
 * The plan table the reference draws: one rounded surface split into
 * columns by hairlines, each column a name, a sentence, the price, a
 * full-width pill, then an "Includes:" caption over a check list. Two
 * columns here, because there are two plans and the second one is a
 * conversation, not a price.
 */
export function PlanCards({ className }: { className?: string }) {
	return (
		<Card
			className={cn(
				"grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0",
				className,
			)}
		>
			{plans.map((plan) => (
				<div key={plan.name} className="flex flex-col p-8 sm:p-10">
					<div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
						<h2 className="text-title text-foreground">{plan.name}</h2>
						{plan.highlight ? (
							<span className="whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-1 text-micro font-medium text-accent-strong">
								Everything included
							</span>
						) : null}
					</div>
					<p className="mt-2 max-w-[30ch] text-small text-muted">{plan.blurb}</p>
					<p className="mt-12 flex items-baseline gap-2 text-headline text-foreground">
						{plan.price}
						{plan.period ? (
							<span className="font-mono text-micro font-normal text-muted-2 uppercase">
								/ {plan.period}
							</span>
						) : null}
					</p>
					<Pill
						href={plan.cta.href}
						variant={plan.highlight ? "primary" : "ghost"}
						size="lg"
						external={plan.cta.href.startsWith("mailto:")}
						className="mt-6 w-full"
					>
						{plan.cta.label}
					</Pill>
					<Eyebrow className="mt-14">Includes:</Eyebrow>
					<ul className="mt-4 flex flex-col gap-3">
						{plan.items.map((item) => (
							<li key={item} className="flex items-start gap-3 text-body text-foreground">
								<Check className="mt-1 size-4 shrink-0 text-muted-2" aria-hidden />
								{item}
							</li>
						))}
					</ul>
				</div>
			))}
		</Card>
	);
}
