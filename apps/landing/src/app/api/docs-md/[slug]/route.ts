import { findDocPage, renderDocPageMarkdown } from "@/lib/docs/markdown";
import { docsPages } from "@/lib/docs/pages";

/**
 * The Markdown behind one docs page, served at `/docs/<slug>.md` through the
 * rewrite in `next.config.ts`. The dotted URL cannot be a route segment of its
 * own — `/docs/[slug]` already owns that position and renders HTML.
 */
export const dynamic = "force-static";

export function generateStaticParams(): Array<{ slug: string }> {
	return docsPages.map((page) => ({ slug: page.slug }));
}

export async function GET(
	_request: Request,
	context: { params: Promise<{ slug: string }> },
): Promise<Response> {
	const { slug } = await context.params;
	const page = findDocPage(slug);
	if (!page) {
		return new Response("Not found\n", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}
	return new Response(renderDocPageMarkdown(page), {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
