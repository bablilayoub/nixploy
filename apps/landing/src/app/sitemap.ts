import type { MetadataRoute } from "next";
import { docsSlugs } from "@/lib/docs/nav";
import { site } from "@/lib/site";

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
		"/pricing",
		"/about",
		"/privacy",
	];
	return paths.map((path) => ({
		url: `${site.url}${path}`,
		lastModified: new Date(),
		changeFrequency: path === "" || path.startsWith("/docs") ? "weekly" : "monthly",
		priority: path === "" ? 1 : path === "/docs" || path === "/api" ? 0.9 : 0.7,
	}));
}
