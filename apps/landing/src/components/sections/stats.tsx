import { stats } from "@/lib/landing-data";
export function Stats() {
	return (
		<section aria-label="Platform at a glance" className="container-page">
			<dl className="grid grid-cols-1 divide-y border-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
				{stats.map((stat) => (
					<div key={stat.id} className="min-w-0 py-7 sm:px-6 sm:first:ps-0">
						<dt className="text-sm font-medium">{stat.label}</dt>
						<dd className="mt-3 font-mono text-4xl font-medium tracking-tight tabular-nums">
							{stat.value}
						</dd>
						<dd className="mt-2 text-xs leading-relaxed text-muted-foreground">{stat.note}</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
