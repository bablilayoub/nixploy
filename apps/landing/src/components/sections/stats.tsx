import { NumberTicker } from "@/components/ui/number-ticker";
import { Separator } from "@/components/ui/separator";
import { stats } from "@/lib/landing-data";

/*
 * Four counted numbers on one rail; the count-up is @magicui/number-ticker.
 *
 * Two up until lg rather than md: at exactly 768 the four columns are narrow
 * enough that "Database engines" and "MiB control plane" both wrap, and a
 * label that wraps under a 48px figure stops reading as one unit.
 */
export function Stats() {
	return (
		<section className="py-8">
			<div className="container-page">
				<div className="grid grid-cols-2 gap-y-10 rounded-2xl border bg-card/40 p-8 backdrop-blur lg:grid-cols-4 lg:gap-0">
					{stats.map((stat, index) => (
						<div key={stat.id} className="flex items-center gap-8 lg:justify-center">
							{index > 0 ? (
								<Separator orientation="vertical" className="hidden !h-14 lg:block" />
							) : null}
							<div className="lg:flex-1 lg:px-6">
								<p className="font-display text-4xl font-semibold tracking-tight tabular-nums lg:text-5xl">
									<NumberTicker value={stat.value} />
								</p>
								<p className="mt-2 text-sm font-medium">{stat.label}</p>
								<p className="mt-0.5 text-xs text-muted-foreground">{stat.note}</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
