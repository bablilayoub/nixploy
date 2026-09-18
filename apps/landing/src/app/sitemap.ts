import type { MetadataRoute } from "next";
import { comparisonSlugs } from "@/lib/compare";
import { docsSlugs } from "@/lib/docs/nav";
import { site } from "@/lib/site";
import { templateSlugs } from "@/lib/templates";

/**
 * Derived from `docsNav`, not from a second hand-written list — the previous
 * copy silently dropped every page added after it was written.
 */
export default function sitemap(): MetadataRoute.Sitemap {
	const paths = [
		"",
		"/features",
		"/docs",
		...docsSlugs.map((slug) => `/docs/${slug}`),
		"/api",
		"/agents",
		"/compare",
		// The canonical form every comparison page declares; `/compare/<slug>`
		// is the route folder behind a rewrite and stays out of the sitemap.
		...comparisonSlugs.map((slug) => `/nixploy-vs-${slug}`),
		"/templates",
		...templateSlugs.map((slug) => `/templates/${slug}`),
		"/pricing",
		"/about",
		"/privacy",
	];
	return paths.map((path) => ({
		url: `${site.url}${path}`,
		lastModified: new Date(),
		changeFrequency: path === "" || path.startsWith("/docs") ? "weekly" : "monthly",
		priority:
			path === ""
				? 1
				: path === "/docs" ||
						path === "/api" ||
						path === "/templates" ||
						path === "/agents" ||
						path.startsWith("/nixploy-vs-")
					? 0.9
					: 0.7,
	}));
}
