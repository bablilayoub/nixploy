"use client";

import { NumberTicker } from "@/components/magicui/number-ticker";
import { Container } from "@/components/ui";
import { stats } from "@/lib/landing-data";

export function Stats() {
	return (
		<section className="border-y border-border bg-surface/40">
			<Container>
				<dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
					{stats.map((stat) => (
						<div
							key={stat.label}
							className="flex flex-col items-center px-2 py-8 text-center sm:px-6"
						>
							<dd className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
								<NumberTicker value={stat.value} suffix={stat.suffix} />
							</dd>
							<dt className="mt-1 text-xs text-muted sm:text-sm">{stat.label}</dt>
						</div>
					))}
				</dl>
			</Container>
		</section>
	);
}
