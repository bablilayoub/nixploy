import type { MetadataRoute } from "next";
import { comparisonSlugs } from "@/lib/compare";
import { docsSlugs } from "@/lib/docs/nav";
import { site } from "@/lib/site";
import { templateSlugs } from "@/lib/templates";

/**
 * Every indexable URL, derived from the registries rather than a second
 * hand-written list — the copy this replaced silently dropped every page added
 * after it was written.
 *
 * Deliberately **not** listed:
 *
 * - `/compare/<slug>`. The pages are served there but `/nixploy-vs-<slug>` is
 *   the canonical URL they declare, so only that form belongs here; listing
 *   both would ask to index the same page twice.
 * - `llms.txt`, `llms-full.txt`, `agents.md` and the `.md` twin of every docs
 *   page. Those are alternate representations for agents, not pages for a
 *   search index, and they are reachable from `/llms.txt` which agents find by
 *   convention rather than by crawling a sitemap.
 *
 * There is no `lastModified`. This is a static build, so a truthful value would
 * have to come from the content's own history, and the obvious shortcut —
 * `new Date()` — stamps all 170 URLs as changed on every deploy whether they
 * changed or not. Search engines discount a lastmod they find unreliable, which
 * makes an always-now value strictly worse than none.
 */

/** 1 for the home page, 0.9 for a section root, 0.7 for everything else. */
function priorityOf(path: string): number {
	if (path === "") return 1;
	const isSectionRoot =
		path === "/docs" ||
		path === "/api" ||
		path === "/templates" ||
		path === "/agents" ||
		path === "/compare" ||
		path.startsWith("/nixploy-vs-");
	return isSectionRoot ? 0.9 : 0.7;
}

export default function sitemap(): MetadataRoute.Sitemap {
	const paths = [
		"",
		"/features",
		"/docs",
		...docsSlugs.map((slug) => `/docs/${slug}`),
		"/api",
		"/agents",
		"/compare",
		...comparisonSlugs.map((slug) => `/nixploy-vs-${slug}`),
		"/templates",
		...templateSlugs.map((slug) => `/templates/${slug}`),
		"/pricing",
		"/about",
		"/privacy",
	];

	// A duplicate would ask for the same page twice; the registries are separate
	// files and nothing stops one of them growing an entry the other has.
	const seen = new Set<string>();
	return paths
		.filter((path) => !seen.has(path) && seen.add(path))
		.map((path) => ({
			url: `${site.url}${path}`,
			changeFrequency: path === "" || path.startsWith("/docs") ? "weekly" : "monthly",
			priority: priorityOf(path),
		}));
}
