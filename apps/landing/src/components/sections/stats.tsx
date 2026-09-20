import { NumberTicker } from "@/components/ui/number-ticker";
import { Separator } from "@/components/ui/separator";
import { stats } from "@/lib/landing-data";

/* Four counted numbers; the count-up is @magicui/number-ticker. */
export function Stats() {
	return (
		<section className="py-8">
			<div className="container-page grid grid-cols-2 gap-y-10 rounded-2xl border border-white/10 bg-card/40 p-8 backdrop-blur md:grid-cols-4 md:gap-0">
				{stats.map((stat, index) => (
					<div key={stat.id} className="flex items-center gap-8 md:justify-center">
						{index > 0 ? (
							<Separator orientation="vertical" className="hidden !h-14 md:block" />
						) : null}
						<div className="md:flex-1 md:px-6">
							<p className="font-display text-4xl font-semibold tracking-tight tabular-nums lg:text-5xl">
								<NumberTicker value={stat.value} />
							</p>
							<p className="mt-2 text-sm font-medium">{stat.label}</p>
							<p className="mt-0.5 text-xs text-muted-foreground">{stat.note}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
