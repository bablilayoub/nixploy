import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocArticle } from "@/components/doc-article";
import { DocsFrame } from "@/components/docs-frame";
import { docHeadings } from "@/lib/docs/headings";
import { docsSlugs } from "@/lib/docs/nav";
import { getDocPage } from "@/lib/docs/pages";

export function generateStaticParams() {
	return docsSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const page = getDocPage(slug);
	if (!page) return { title: "Docs — Nixploy" };
	return {
		title: `${page.title} — Nixploy Docs`,
		description: page.description,
	};
}

export default async function DocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const page = getDocPage(slug);
	if (!page) notFound();
	return (
		<DocsFrame activeHref={`/docs/${slug}`} headings={docHeadings(page.blocks)}>
			<DocArticle page={page} />
		</DocsFrame>
	);
}
