import type { Metadata } from "next";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "API — Nixploy",
	description:
		"REST API for Nixploy: x-api-key auth, /api/<router>.<procedure> paths, CLI, and panel Swagger.",
};

export default function ApiPage() {
	return (
		<PageShell
			eyebrow="API"
			title="One REST surface for scripts, CI, and the CLI."
			description="Every tRPC procedure is also a REST endpoint. Live OpenAPI lives on your panel — not on this site."
		>
			<div className="grid max-w-3xl gap-12 text-[15px] leading-relaxed text-muted">
				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Authentication
					</h2>
					<p>
						Create a key under{" "}
						<strong className="font-medium text-foreground">Settings → Profile</strong> and send it
						on every request:
					</p>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`x-api-key: nxlp_...`}
					</pre>
				</section>

				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						URL conventions
					</h2>
					<ul className="list-disc space-y-2 pl-5">
						<li>
							Queries →{" "}
							<code className="font-mono text-foreground/90">
								GET /api/&lt;router&gt;.&lt;procedure&gt;
							</code>
						</li>
						<li>
							Mutations →{" "}
							<code className="font-mono text-foreground/90">
								POST /api/&lt;router&gt;.&lt;procedure&gt;
							</code>
						</li>
						<li>
							No fake version prefix — paths are not under{" "}
							<code className="font-mono">/api/v1</code>.
						</li>
					</ul>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`curl -sS -H "x-api-key: $NIXPLOY_API_KEY" \\
  "https://panel.example.com/api/project.all"`}
					</pre>
				</section>

				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Swagger on your panel
					</h2>
					<p>
						Open <code className="font-mono text-foreground/90">/swagger</code> on your installed
						panel for interactive docs, or fetch{" "}
						<code className="font-mono text-foreground/90">/api/openapi.json</code>. nixploy.com
						does not host the live schema.
					</p>
				</section>

				<section className="space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">CLI</h2>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`npm i -g @nixploy/cli
nixploy auth login --url https://panel.example.com --api-key nxlp_...
nixploy doctor`}
					</pre>
				</section>

				<section className="space-y-3">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Full guide
					</h2>
					<ul className="list-disc space-y-2 pl-5">
						<li>
							<ProseLink href={site.githubApiDocs}>docs/api.md</ProseLink> in the repository
						</li>
						<li>
							<ProseLink href={`${site.github}/blob/main/docs/auth.md`}>auth.md</ProseLink> — API
							keys &amp; roles
						</li>
						<li>
							<ProseLink href="/docs">Getting started on this site</ProseLink>
						</li>
					</ul>
				</section>
			</div>
		</PageShell>
	);
}
