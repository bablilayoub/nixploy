const steps = [
	{
		n: "01",
		title: "Install on your server",
		body: "One curl. Docker Swarm and Traefik come up with the panel.",
	},
	{
		n: "02",
		title: "Connect a project",
		body: "Git repo, Docker image, or compose file — pick a builder and deploy.",
	},
	{
		n: "03",
		title: "Ship and observe",
		body: "Domains, TLS, logs, metrics, and rollbacks from one control plane.",
	},
] as const;

export function HowItWorks() {
	return (
		<section id="how" className="border-t border-border py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-xl">
					<p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">How it works</p>
					<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						From bare metal to production.
					</h2>
				</div>
				<ol className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
					{steps.map((step) => (
						<li key={step.n}>
							<p className="font-mono text-xs text-muted">{step.n}</p>
							<h3 className="mt-3 font-display text-lg font-semibold tracking-tight">
								{step.title}
							</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
