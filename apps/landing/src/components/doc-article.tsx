import { Info } from "lucide-react";

import { ProseLink } from "@/components/page-frame";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import type { DocBlock, DocPage } from "@/lib/docs/pages";
import { site } from "@/lib/site";

/*
 * Renders one docs page's blocks. Typography comes from the Tailwind
 * typography plugin, code from @aceternity/code-block; this file is the
 * mapping from our block union to those, nothing more.
 */
function blockKey(block: DocBlock): string {
	switch (block.type) {
		case "h2":
		case "p":
		case "note":
			return `${block.type}:${block.text}`;
		case "ul":
		case "ol":
			return `${block.type}:${block.items.join("|")}`;
		case "pre":
			return `pre:${block.code}`;
	}
}

/*
 * Block keys are content-derived and a page may legitimately repeat a block —
 * the install one-liner appears twice on several pages, which collided and
 * made React drop one of them. Duplicates take an occurrence suffix.
 */
function withKeys(blocks: readonly DocBlock[]): { key: string; block: DocBlock }[] {
	const seen = new Map<string, number>();
	return blocks.map((block) => {
		const base = blockKey(block);
		const seenBefore = seen.get(base) ?? 0;
		seen.set(base, seenBefore + 1);
		return { key: seenBefore === 0 ? base : `${base}#${seenBefore}`, block };
	});
}

function Block({ block }: { block: DocBlock }) {
	switch (block.type) {
		case "h2":
			return <h2 className="mt-12 scroll-mt-28 text-2xl font-semibold">{block.text}</h2>;
		case "p":
			return <p className="mt-4 text-muted-foreground">{block.text}</p>;
		case "ul":
			return (
				<ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			);
		case "ol":
			return (
				<ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ol>
			);
		case "pre":
			return (
				<div className="mt-5">
					<CodeBlock language="bash" filename="sh" code={block.code} />
				</div>
			);
		case "note":
			return (
				<Card className="mt-5 flex-row gap-3 p-4 text-sm text-muted-foreground">
					<Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
					<p>{block.text}</p>
				</Card>
			);
		default:
			return null;
	}
}

export function DocArticle({ page }: { page: DocPage }) {
	return (
		<article>
			<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">Docs</p>
			<h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance">{page.title}</h1>
			<p className="mt-4 text-lg text-muted-foreground">{page.description}</p>
			<div className="mt-10">
				{withKeys(page.blocks).map(({ key, block }) => (
					<Block key={key} block={block} />
				))}
			</div>
			<p className="mt-16 border-t pt-6 text-sm text-muted-foreground">
				Also see the repository guides under <ProseLink href={site.githubDocs}>docs/</ProseLink>
				{" · "}
				<ProseLink href="/api">REST API reference</ProseLink>
			</p>
		</article>
	);
}
