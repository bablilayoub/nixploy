import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DocsShell } from "@/components/docs/docs-shell";
import { ProseLink } from "@/components/page-shell";
import { CodeBlock, Eyebrow, Panel } from "@/components/ui";
import { apiCatalog, apiEndpointCount } from "@/lib/docs/api-catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "API Reference — Nixploy",
	description:
		"Nixploy REST API: x-api-key auth, /api/<router>.<procedure> paths, endpoint catalog, CLI, and panel Swagger.",
};

const AUTH_HEADER = "x-api-key: nxp_...";

const CURL = `# List projects
curl -sS -H "x-api-key: $NIXPLOY_API_KEY" \\
  "https://panel.example.com/api/project.all"

# Create a project
curl -sS -X POST \\
  -H "x-api-key: $NIXPLOY_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"my-app"}' \\
  "https://panel.example.com/api/project.create"`;

const CLI = `npm i -g @nixploy/cli
echo "$NIXPLOY_API_KEY" | nixploy auth login --url https://panel.example.com
nixploy doctor
nixploy app list --project-id <id>`;

/*
 * The reading column's own rhythm: a subtitle per section with 64px above it,
 * body paragraphs in muted, code in the terminal chrome. Inline code and
 * emphasis are lifted to the foreground so the eye can pick a path or a key
 * name out of a muted sentence.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-16">
			<h2 className="text-subtitle text-foreground">{title}</h2>
			{children}
		</section>
	);
}

function P({ children }: { children: ReactNode }) {
	return <p className="mt-4 text-body text-muted">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
	return <code className="font-mono text-small text-foreground">{children}</code>;
}

function Strong({ children }: { children: ReactNode }) {
	return <strong className="font-medium text-foreground">{children}</strong>;
}

export default function ApiPage() {
	return (
		<DocsShell activeHref="/api">
			<article>
				<Eyebrow className="mb-4">API</Eyebrow>
				<h1 className="text-title text-balance text-foreground sm:text-headline">
					REST API reference
				</h1>
				<p className="mt-5 text-lead text-muted">
					Every tRPC procedure is also a REST endpoint. The same surface powers the dashboard,
					Swagger UI, <Code>@nixploy/cli</Code>, and MCP.
				</p>

				<Section title="Authentication">
					<P>
						Create a key under <Strong>Settings → Profile</Strong> on your panel. Send it on every
						request:
					</P>
					<CodeBlock className="mt-6" title="x-api-key" code={AUTH_HEADER} />
					<P>
						Keys are <Strong>scoped</Strong> (read, deploy, write or admin) and bound to one
						organization. The effective permission set is the scope intersected with the key
						owner&apos;s own capabilities, so a <Code>write</Code> key held by a viewer still cannot
						write. New keys expire after 90 days by default.
					</P>
				</Section>

				<Section title="URL conventions">
					<ul className="mt-4 list-disc space-y-2 pl-5 text-body text-muted marker:text-muted-2">
						<li>
							Queries → <Code>GET /api/&lt;router&gt;.&lt;procedure&gt;</Code>
						</li>
						<li>
							Mutations → <Code>POST /api/&lt;router&gt;.&lt;procedure&gt;</Code>
						</li>
						<li>
							Nested input → URL-encoded JSON <Code>?input=...</Code> on GET
						</li>
						<li>No /api/v1 prefix</li>
					</ul>
					<CodeBlock className="mt-6" title="curl" code={CURL} />
				</Section>

				<Section title="Interactive docs on your panel">
					<P>Live OpenAPI lives on the installed panel (not mirrored here):</P>
					<ul className="mt-4 list-disc space-y-2 pl-5 text-body text-muted marker:text-muted-2">
						<li>
							UI: <Code>https://&lt;panel&gt;/swagger</Code>
						</li>
						<li>
							Spec: <Code>https://&lt;panel&gt;/api/openapi.json</Code>
						</li>
					</ul>
					<P>
						Use the Authorize button with your <Code>x-api-key</Code>.
					</P>
				</Section>

				<Section title="CLI">
					<CodeBlock className="mt-6" title="cli" code={CLI} />
					<p className="mt-4 text-small text-muted">
						<ProseLink href="/docs/cli">CLI guide</ProseLink>
						{" · "}
						<ProseLink href="/docs/mcp">MCP for agents</ProseLink>
					</p>
				</Section>

				<Section title="Endpoint catalog">
					<P>
						All {apiEndpointCount} endpoints across {apiCatalog.length} routers, generated from the
						router itself. The <Strong>Requires</Strong> column lists the organization capabilities
						the key&apos;s user must hold; “instance admin” marks the operations that additionally
						need the platform owner. Full descriptions and input/output schemas live on your own
						panel&apos;s Swagger, which always matches the version you run.
					</P>
					{apiCatalog.map((group) => (
						<Panel key={group.router} className="mt-6">
							<h3 className="text-body font-medium text-foreground">{group.title}</h3>
							<p className="mt-1 text-small text-muted">{group.description}</p>
							<p className="mt-1 font-mono text-micro text-muted-2">router: {group.router}</p>
							<div className="mt-4 overflow-x-auto rounded-xl border border-border">
								<table className="w-full min-w-[34rem] text-left">
									<caption className="sr-only">{group.title} endpoints</caption>
									<thead className="text-micro text-muted-2">
										<tr>
											<th scope="col" className="px-3 py-2 font-medium">
												Method
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												Path
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												Summary
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												Requires
											</th>
										</tr>
									</thead>
									<tbody>
										{group.endpoints.map((ep) => (
											<tr
												key={`${ep.method}-${ep.path}`}
												className="border-t border-border text-small"
											>
												<td className="px-3 py-2 font-mono text-micro text-foreground">
													{ep.method}
												</td>
												<td className="px-3 py-2 font-mono text-micro text-foreground">
													/api/{ep.path}
												</td>
												<td className="px-3 py-2 text-muted">{ep.summary}</td>
												<td className="px-3 py-2 font-mono text-micro text-muted-2">
													{[
														...(ep.capability ?? []),
														...(ep.instanceAdmin ? ["instance admin"] : []),
													].join(", ") || "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Panel>
					))}
				</Section>

				<p className="mt-16 border-t border-border pt-6 text-small text-muted">
					Repository guide: <ProseLink href={site.githubApiDocs}>docs/api.md</ProseLink>
					{" · "}
					<ProseLink href="/docs">All docs</ProseLink>
				</p>
			</article>
		</DocsShell>
	);
}
