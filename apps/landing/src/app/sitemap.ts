import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

const docSlugs = [
	"install",
	"getting-started",
	"migrate",
	"deploy",
	"domains",
	"git",
	"templates",
	"databases",
	"backups",
	"observability",
	"servers",
	"security",
	"schedules",
	"cli",
	"gitops",
	"mcp",
	"ai",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	const paths = [
		"",
		"/features",
		"/docs",
		...docSlugs.map((s) => `/docs/${s}`),
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
