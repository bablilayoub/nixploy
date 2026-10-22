import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ApiExplorer } from "@/components/api-explorer";
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
/*
 * The page's own sections. One list, so the right-hand rail and the headings
 * cannot drift apart — a renamed title used to leave the rail pointing at an
 * id that no longer existed, silently.
 */
const SECTIONS = {
	auth: "Authentication",
	urls: "URL conventions",
	swagger: "Interactive docs on your panel",
	cli: "CLI",
	catalog: "Endpoint catalog",
} as const;

type SectionId = keyof typeof SECTIONS;

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
	const title = SECTIONS[id];
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
			headings={Object.entries(SECTIONS).map(([id, text]) => ({ id, text }))}
		>
			<article className="signal-api-reference">
				<p className="text-xs text-muted-foreground normal-case">API</p>
				<h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-[-0.045em] text-balance">
					REST API reference
				</h1>
				<p className="mt-4 text-lg text-muted-foreground">
					Every tRPC procedure is also a REST endpoint. The same surface powers the dashboard,
					Swagger UI, <Code>@nixploy/cli</Code>, and MCP.
				</p>

				<div className="signal-facts mt-8">
					{[
						{ label: "Interface", value: "REST + OpenAPI" },
						{ label: "Authentication", value: "Scoped API keys" },
						{ label: "Endpoints", value: apiEndpointCount },
					].map((item) => (
						<div key={item.label}>
							<p className="text-xs text-muted-foreground">{item.label}</p>
							<p className="mt-2 text-sm font-medium">{item.value}</p>
						</div>
					))}
				</div>
				<Section id="auth">
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

				<Section id="urls">
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

				<Section id="swagger">
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

				<Section id="cli">
					<div className="mt-6">
						<CodeBlock language="bash" filename="cli" code={CLI} />
					</div>
					<p className="mt-4 text-sm text-muted-foreground">
						<ProseLink href="/docs/cli">CLI guide</ProseLink>
						{" · "}
						<ProseLink href="/docs/mcp">MCP for agents</ProseLink>
					</p>
				</Section>

				<Section id="catalog">
					<P>
						All {apiEndpointCount} endpoints across {apiCatalog.length} routers, generated from the
						router itself. The <Strong>Requires</Strong> column lists the organization capabilities
						the key&apos;s user must hold; “instance admin” marks the operations that additionally
						need the platform owner. Full descriptions and input/output schemas live on your own
						panel&apos;s Swagger, which always matches the version you run.
					</P>
					{/* An index first: 49 routers with every table open is a page nobody
					    can navigate, so each router is a disclosure and this is the way in. */}
					<ApiExplorer groups={apiCatalog} />
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
