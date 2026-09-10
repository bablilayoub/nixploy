"use client";

import { NumberTicker } from "@/components/magicui/number-ticker";
import { Container } from "@/components/ui";
import { heroStats } from "@/lib/landing-data";

export function Stats() {
	return (
		<section className="py-12 sm:py-16">
			<Container>
				<dl className="grid gap-10 sm:grid-cols-3 sm:gap-6">
					{heroStats.map((stat, i) => (
						<div
							key={stat.label}
							className={
								i > 0
									? "flex items-baseline gap-4 sm:border-l sm:border-border sm:pl-8"
									: "flex items-baseline gap-4"
							}
						>
							<dd className="font-display text-4xl font-semibold text-foreground sm:text-5xl">
								<NumberTicker value={stat.value} suffix={stat.suffix} />
							</dd>
							<dt className="max-w-[10rem] text-sm leading-snug text-muted">{stat.label}</dt>
						</div>
					))}
				</dl>
			</Container>
		</section>
	);
}
