import type { Metadata } from "next";
import Link from "next/link";

import { DocsShell } from "@/components/docs/docs-shell";
import { ProseLink } from "@/components/page-shell";
import { apiCatalog } from "@/lib/docs/api-catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "API Reference — Nixploy",
	description:
		"Nixploy REST API: x-api-key auth, /api/<router>.<procedure> paths, endpoint catalog, CLI, and panel Swagger.",
};

export default function ApiPage() {
	return (
		<DocsShell activeHref="/api">
			<article>
				<p className="mb-3 eyebrow">API</p>
				<h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					REST API reference
				</h1>
				<p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
					Every tRPC procedure is also a REST endpoint. The same surface powers the dashboard,
					Swagger UI, <code className="font-mono text-foreground/90">@nixploy/cli</code>, and MCP.
				</p>

				<section className="mt-12 space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Authentication
					</h2>
					<p className="text-[15px] leading-relaxed text-muted">
						Create a key under{" "}
						<strong className="font-medium text-foreground">Settings → Profile</strong> on your
						panel. Send it on every request:
					</p>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`x-api-key: nxlp_...`}
					</pre>
				</section>

				<section className="mt-12 space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						URL conventions
					</h2>
					<ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
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
							Nested input → URL-encoded JSON{" "}
							<code className="font-mono text-foreground/90">?input=...</code> on GET
						</li>
						<li>No /api/v1 prefix</li>
					</ul>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`# List projects
curl -sS -H "x-api-key: $NIXPLOY_API_KEY" \\
  "https://panel.example.com/api/project.all"

# Create a project
curl -sS -X POST \\
  -H "x-api-key: $NIXPLOY_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"my-app"}' \\
  "https://panel.example.com/api/project.create"`}
					</pre>
				</section>

				<section className="mt-12 space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Interactive docs on your panel
					</h2>
					<p className="text-[15px] leading-relaxed text-muted">
						Live OpenAPI lives on the installed panel (not mirrored here):
					</p>
					<ul className="list-disc space-y-2 pl-5 text-[15px] text-muted">
						<li>
							UI:{" "}
							<code className="font-mono text-foreground/90">https://&lt;panel&gt;/swagger</code>
						</li>
						<li>
							Spec:{" "}
							<code className="font-mono text-foreground/90">
								https://&lt;panel&gt;/api/openapi.json
							</code>
						</li>
					</ul>
					<p className="text-[15px] text-muted">
						Use the Authorize button with your <code className="font-mono">x-api-key</code>.
					</p>
				</section>

				<section className="mt-12 space-y-4">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">CLI</h2>
					<pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
						{`npm i -g @nixploy/cli
nixploy auth login --url https://panel.example.com --api-key nxlp_...
nixploy doctor
nixploy app list --project-id <id>`}
					</pre>
					<p className="text-sm text-muted">
						<ProseLink href="/docs/cli">CLI guide</ProseLink>
						{" · "}
						<ProseLink href="/docs/mcp">MCP for agents</ProseLink>
					</p>
				</section>

				<section className="mt-14">
					<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
						Endpoint catalog
					</h2>
					<p className="mt-2 text-sm text-muted">
						High-traffic procedures. Full schemas and every mutation are on panel Swagger.
					</p>
					<div className="mt-8 space-y-10">
						{apiCatalog.map((group) => (
							<div key={group.router} className="border-t border-border pt-6">
								<h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
									{group.title}
								</h3>
								<p className="mt-1 text-sm text-muted">{group.description}</p>
								<p className="mt-1 font-mono text-xs text-muted/80">router: {group.router}</p>
								<div className="mt-4 overflow-x-auto rounded-lg border border-border">
									<table className="w-full min-w-[28rem] text-left text-sm">
										<thead className="border-b border-border bg-surface/80 text-xs text-muted uppercase">
											<tr>
												<th className="px-3 py-2 font-medium">Method</th>
												<th className="px-3 py-2 font-medium">Path</th>
												<th className="px-3 py-2 font-medium">Summary</th>
											</tr>
										</thead>
										<tbody>
											{group.endpoints.map((ep) => (
												<tr key={`${ep.method}-${ep.path}`} className="border-b border-border/60">
													<td className="px-3 py-2 font-mono text-xs text-foreground">
														{ep.method}
													</td>
													<td className="px-3 py-2 font-mono text-xs text-foreground/90">
														/api/{ep.path}
													</td>
													<td className="px-3 py-2 text-muted">{ep.summary}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						))}
					</div>
				</section>

				<p className="mt-14 border-t border-border pt-6 text-sm text-muted">
					Repository guide: <ProseLink href={site.githubApiDocs}>docs/api.md</ProseLink>
					{" · "}
					<Link href="/docs" className="text-foreground underline underline-offset-4">
						All docs
					</Link>
				</p>
			</article>
		</DocsShell>
	);
}
