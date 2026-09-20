import type { DocBlock } from "./pages";

/**
 * Anchors for a docs page's section headings.
 *
 * The heading text is the only identifier a block has, so the id is derived
 * from it and a repeated heading takes a numeric suffix — the same rule the
 * block keys use, for the same reason (several pages repeat "Verify").
 */
export function headingId(text: string, occurrence = 0): string {
	const base = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	const slug = base || "section";
	return occurrence === 0 ? slug : `${slug}-${occurrence + 1}`;
}

export type DocHeading = { id: string; text: string };

/** The page's `h2` blocks, in order, with the ids `DocArticle` renders. */
export function docHeadings(blocks: readonly DocBlock[]): DocHeading[] {
	const seen = new Map<string, number>();
	const headings: DocHeading[] = [];
	for (const block of blocks) {
		if (block.type !== "h2") continue;
		const occurrence = seen.get(block.text) ?? 0;
		seen.set(block.text, occurrence + 1);
		headings.push({ id: headingId(block.text, occurrence), text: block.text });
	}
	return headings;
}
