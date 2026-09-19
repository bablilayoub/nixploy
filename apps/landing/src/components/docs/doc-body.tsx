import { Info } from "lucide-react";

import { ProseLink } from "@/components/page-shell";
import { CodeBlock, Eyebrow } from "@/components/ui";
import type { DocBlock, DocPage } from "@/lib/docs/pages";
import { site } from "@/lib/site";

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
 * Block keys are content-derived, and a page may legitimately repeat a block —
 * the install one-liner appears twice on several docs pages, which collided and
 * made React drop one of them. Duplicates get an occurrence suffix. The code
 * block's key must be the whole snippet, not a prefix: two long commands that
 * share an opening collide otherwise.
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

/* One block of a docs page, on the same ladder as the rest of the site. */
function Block({ block }: { block: DocBlock }) {
	switch (block.type) {
		case "h2":
			return <h2 className="mt-12 text-subtitle text-foreground first:mt-0">{block.text}</h2>;
		case "p":
			return <p className="mt-4 text-body text-muted">{block.text}</p>;
		case "ul":
			return (
				<ul className="mt-4 list-disc space-y-2 pl-5 text-body text-muted marker:text-muted-2">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			);
		case "ol":
			return (
				<ol className="mt-4 list-decimal space-y-2 pl-5 text-body text-muted marker:text-muted-2">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ol>
			);
		case "pre":
			return <CodeBlock code={block.code} className="mt-5" />;
		case "note":
			return (
				<div className="mt-5 flex gap-3 rounded-2xl border border-border bg-surface px-5 py-4 text-small text-muted">
					<Info className="mt-0.5 size-4 shrink-0 text-muted-2" aria-hidden />
					<p>{block.text}</p>
				</div>
			);
		default:
			return null;
	}
}

export function DocBody({ page }: { page: DocPage }) {
	return (
		<article>
			<Eyebrow className="mb-4">Docs</Eyebrow>
			<h1 className="text-title text-balance text-foreground sm:text-headline">{page.title}</h1>
			<p className="mt-4 text-lead text-muted">{page.description}</p>
			<div className="mt-12">
				{withKeys(page.blocks).map(({ key, block }) => (
					<Block key={key} block={block} />
				))}
			</div>
			<p className="mt-16 border-t border-border pt-6 text-small text-muted">
				Also see the repository guides under <ProseLink href={site.githubDocs}>docs/</ProseLink>
				{" · "}
				<ProseLink href="/api">REST API reference</ProseLink>
			</p>
		</article>
	);
}
