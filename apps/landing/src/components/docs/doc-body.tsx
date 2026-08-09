import { ProseLink } from "@/components/page-shell";
import type { DocBlock, DocPage } from "@/lib/docs/pages";

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
			return `pre:${block.code.slice(0, 80)}`;
	}
}

function Block({ block }: { block: DocBlock }) {
	switch (block.type) {
		case "h2":
			return (
				<h2 className="mt-10 font-display text-xl font-semibold tracking-tight text-foreground first:mt-0">
					{block.text}
				</h2>
			);
		case "p":
			return <p className="mt-3 text-[15px] leading-relaxed text-muted">{block.text}</p>;
		case "ul":
			return (
				<ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			);
		case "ol":
			return (
				<ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
					{block.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ol>
			);
		case "pre":
			return (
				<pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs text-foreground/90">
					{block.code}
				</pre>
			);
		case "note":
			return (
				<p className="mt-4 rounded-lg border border-border bg-surface/80 px-4 py-3 text-sm text-muted">
					{block.text}
				</p>
			);
		default:
			return null;
	}
}

export function DocBody({ page }: { page: DocPage }) {
	return (
		<article>
			<p className="mb-3 font-mono text-xs tracking-[0.18em] text-muted uppercase">Docs</p>
			<h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				{page.title}
			</h1>
			<p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{page.description}</p>
			<div className="mt-10">
				{page.blocks.map((block) => (
					<Block key={blockKey(block)} block={block} />
				))}
			</div>
			<p className="mt-14 border-t border-border pt-6 text-sm text-muted">
				Also see the repository guides under{" "}
				<ProseLink href="https://github.com/bablilayoub/nixploy/tree/main/docs">docs/</ProseLink>
				{" · "}
				<ProseLink href="/api">REST API reference</ProseLink>
			</p>
		</article>
	);
}
