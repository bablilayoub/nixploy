import { templateCount } from "@/lib/templates";
import { type DocBlock, type DocPage, docsPages } from "./pages";

/**
 * The docs as Markdown, for machines.
 *
 * `/llms.txt` and `/llms-full.txt` are the convention agents look for before
 * they start scraping HTML, and an agent that reads the text we wrote beats one
 * that infers Nixploy's shape from a rendered page. Everything here is
 * generated from `pages.ts`, the same source the site renders — a second,
 * hand-maintained copy would be wrong within a release.
 */

const SITE = "https://nixploy.com";

function renderBlock(block: DocBlock): string {
	switch (block.type) {
		case "h2":
			return `## ${block.text}`;
		case "p":
			return block.text;
		case "ul":
			return block.items.map((item) => `- ${item}`).join("\n");
		case "ol":
			return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
		case "pre":
			return `\`\`\`bash\n${block.code}\n\`\`\``;
		case "note":
			// Blockquote, so a note keeps reading as an aside rather than melting
			// into the paragraph above it.
			return `> **Note:** ${block.text}`;
	}
}

/** One documentation page as a standalone Markdown document. */
export function renderDocPageMarkdown(page: DocPage): string {
	return [
		`# ${page.title}`,
		"",
		page.description,
		"",
		...page.blocks.map(renderBlock).flatMap((text) => [text, ""]),
		`---`,
		`Source: ${SITE}/docs/${page.slug}`,
		"",
	].join("\n");
}

/**
 * `/llms.txt` — the index: what Nixploy is, then one line per page with its
 * Markdown URL. Short on purpose; an agent fetches the pages it needs.
 */
export function renderLlmsTxt(): string {
	return [
		"# Nixploy",
		"",
		"> Self-hosted PaaS: deploy applications, compose stacks and databases onto your own",
		"> Docker Swarm, with Traefik routing, TLS, backups and observability. One process, one",
		"> box, no per-seat pricing. Everything below is the operator documentation.",
		"",
		"Nixploy is driven three ways, all through the same routers, so the organization scope,",
		"the capability checks and the audit trail apply identically to each:",
		"",
		`- **MCP** at \`https://<your-panel>/api/mcp\` — the right surface for an agent. Tools carry`,
		"  behaviour annotations, and `deploy_and_wait`, `explain_last_failure`,",
		"  `get_service_runtime_summary` and `get_service_events` answer in one call what would",
		"  otherwise be a polling loop.",
		`- **REST** at \`https://<your-panel>/api/<router>.<procedure>\` with an \`x-api-key\` header.`,
		"- **CLI**: `npm i -g @nixploy/cli`.",
		"",
		`See ${SITE}/agents.md for how to drive it as an agent, and ${SITE}/agents for`,
		"what that looks like end to end.",
		"",
		"## Docs",
		"",
		...docsPages.map(
			(page) => `- [${page.title}](${SITE}/docs/${page.slug}.md): ${page.description}`,
		),
		"",
		"## Optional",
		"",
		`- [Templates](${SITE}/templates): ${templateCount} reviewed Compose stacks, one page each —`,
		"  what each one runs, which variables it asks for and how to back it up.",
		`- [Everything, in one file](${SITE}/llms-full.txt)`,
		`- [API catalog](${SITE}/api)`,
		`- [Source](https://github.com/bablilayoub/nixploy)`,
		"",
	].join("\n");
}

/** `/llms-full.txt` — every page, concatenated, for a one-shot read. */
export function renderLlmsFullTxt(): string {
	return [renderLlmsTxt(), "", "---", "", ...docsPages.map(renderDocPageMarkdown)].join("\n");
}

/** The page a slug names, or undefined. */
export const findDocPage = (slug: string): DocPage | undefined =>
	docsPages.find((page) => page.slug === slug);
