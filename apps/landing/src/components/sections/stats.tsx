import { stats } from "@/lib/landing-data";
export function Stats() {
	return (
		<section aria-label="Included in the platform" className="container-page py-12">
			<div className="signal-proof-strip">
				<p className="max-w-xs text-lg font-medium tracking-tight">
					Small control plane.
					<br />
					<span className="text-muted-foreground">Full platform.</span>
				</p>
				<dl className="grid flex-1 grid-cols-1 gap-8 sm:grid-cols-3">
					{stats
						.filter((stat) => stat.id !== "control-plane")
						.map((stat) => (
							<div key={stat.id}>
								<dt className="text-xs text-muted-foreground">{stat.label}</dt>
								<dd className="mt-2 font-mono text-3xl tracking-tight">{stat.value}</dd>
								<dd className="mt-2 text-xs text-muted-foreground">{stat.note}</dd>
							</div>
						))}
				</dl>
			</div>
		</section>
	);
}
