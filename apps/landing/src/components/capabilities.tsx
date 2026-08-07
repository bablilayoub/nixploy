const capabilities = [
	{
		title: "Applications",
		body: "Git providers, Nixpacks, Dockerfile, buildpacks, static sites, and images.",
	},
	{
		title: "Databases",
		body: "Postgres, MySQL, MariaDB, Mongo, Redis — with backups and restores.",
	},
	{
		title: "Compose & Swarm",
		body: "Native Docker Compose / Swarm stacks next to your apps.",
	},
	{
		title: "Domains & TLS",
		body: "Traefik routing and Let's Encrypt certificates out of the box.",
	},
	{
		title: "Observability",
		body: "Live logs, metrics history, alerts, and a web terminal.",
	},
	{
		title: "API & CLI",
		body: "REST with x-api-key, OpenAPI on your panel, and @nixploy/cli.",
	},
] as const;

export function Capabilities() {
	return (
		<section id="capabilities" className="border-t border-border py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-xl">
					<p className="font-mono text-xs tracking-[0.18em] text-amber uppercase">What you get</p>
					<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						A full PaaS on your terms.
					</h2>
					<p className="mt-4 text-muted">
						The essentials, without the platform tax. Details on the{" "}
						<a
							href="/features"
							className="text-amber-soft underline decoration-amber/40 underline-offset-4"
						>
							features
						</a>{" "}
						page.
					</p>
				</div>
				<ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
					{capabilities.map((item) => (
						<li key={item.title}>
							<h3 className="font-display text-base font-semibold tracking-tight">{item.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
