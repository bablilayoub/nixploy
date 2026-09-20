import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DocsFrame } from "@/components/docs-frame";
import { ProseLink } from "@/components/page-frame";
import { CodeBlock } from "@/components/ui/code-block";
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
	const id = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return (
		<section id={id} className="mt-16 scroll-mt-28">
			<h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
			{children}
		</section>
	);
}

function P({ children }: { children: ReactNode }) {
	return <p className="mt-4 text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
	return <code className="rounded bg-accent px-1 py-0.5 font-mono text-sm">{children}</code>;
}

function Strong({ children }: { children: ReactNode }) {
	return <strong className="font-medium text-foreground">{children}</strong>;
}

export default function ApiPage() {
	return (
		<DocsFrame
			activeHref="/api"
			headings={[
				{ id: "authentication", text: "Authentication" },
				{ id: "url-conventions", text: "URL conventions" },
				{ id: "interactive-docs-on-your-panel", text: "Interactive docs" },
				{ id: "cli", text: "CLI" },
				{ id: "endpoint-catalog", text: "Endpoint catalog" },
			]}
		>
			<article>
				<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">API</p>
				<h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance">
					REST API reference
				</h1>
				<p className="mt-4 text-lg text-muted-foreground">
					Every tRPC procedure is also a REST endpoint. The same surface powers the dashboard,
					Swagger UI, <Code>@nixploy/cli</Code>, and MCP.
				</p>

				<Section title="Authentication">
					<P>
						Create a key under <Strong>Settings → Profile</Strong> on your panel. Send it on every
						request:
					</P>
					<div className="mt-6">
						<CodeBlock language="bash" filename="x-api-key" code={AUTH_HEADER} />
					</div>
					<P>
						Keys are <Strong>scoped</Strong> (read, deploy, write or admin) and bound to one
						organization. The effective permission set is the scope intersected with the key
						owner&apos;s own capabilities, so a <Code>write</Code> key held by a viewer still cannot
						write. New keys expire after 90 days by default.
					</P>
				</Section>

				<Section title="URL conventions">
					<ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
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
					<div className="mt-6">
						<CodeBlock language="bash" filename="curl" code={CURL} />
					</div>
				</Section>

				<Section title="Interactive docs on your panel">
					<P>Live OpenAPI lives on the installed panel (not mirrored here):</P>
					<ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
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
					<div className="mt-6">
						<CodeBlock language="bash" filename="cli" code={CLI} />
					</div>
					<p className="mt-4 text-sm text-muted-foreground">
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
					{/* An index first: 49 routers with every table open is a page nobody
					    can navigate, so each router is a disclosure and this is the way in. */}
					<nav aria-label="Routers" className="mt-6 flex flex-wrap gap-2">
						{apiCatalog.map((group) => (
							<a
								key={group.router}
								href={`#router-${group.router}`}
								className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
							>
								{group.router}
								<span className="text-muted-foreground/60">{group.endpoints.length}</span>
							</a>
						))}
					</nav>

					<div className="mt-8 flex flex-col gap-3">
						{apiCatalog.map((group) => (
							<details
								key={group.router}
								id={`router-${group.router}`}
								className="group scroll-mt-28 rounded-xl border bg-card/40"
							>
								<summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
										aria-hidden
									/>
									<span className="min-w-0 flex-1">
										<span className="block font-medium">{group.title}</span>
										<span className="mt-0.5 block text-sm text-muted-foreground">
											{group.description}
										</span>
									</span>
									<span className="shrink-0 font-mono text-xs text-muted-foreground">
										{group.router} · {group.endpoints.length}
									</span>
								</summary>
								<div className="overflow-x-auto border-t">
									<table className="w-full min-w-[34rem] text-left">
										<caption className="sr-only">{group.title} endpoints</caption>
										<thead className="text-xs text-muted-foreground">
											<tr>
												<th scope="col" className="px-4 py-2 font-medium">
													Method
												</th>
												<th scope="col" className="px-4 py-2 font-medium">
													Path
												</th>
												<th scope="col" className="px-4 py-2 font-medium">
													Summary
												</th>
												<th scope="col" className="px-4 py-2 font-medium">
													Requires
												</th>
											</tr>
										</thead>
										<tbody>
											{group.endpoints.map((ep) => (
												<tr key={`${ep.method}-${ep.path}`} className="border-t text-sm">
													<td className="px-4 py-2 font-mono text-xs">{ep.method}</td>
													<td className="px-4 py-2 font-mono text-xs">/api/{ep.path}</td>
													<td className="px-4 py-2 text-muted-foreground">{ep.summary}</td>
													<td className="px-4 py-2 font-mono text-xs text-muted-foreground">
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
							</details>
						))}
					</div>
				</Section>

				<p className="mt-16 border-t pt-6 text-sm text-muted-foreground">
					Repository guide: <ProseLink href={site.githubApiDocs}>docs/api.md</ProseLink>
					{" · "}
					<ProseLink href="/docs">All docs</ProseLink>
				</p>
			</article>
		</DocsFrame>
	);
}
