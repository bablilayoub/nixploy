import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
	const paths = ["", "/features", "/docs", "/api", "/install", "/pricing", "/about", "/privacy"];
	return paths.map((path) => ({
		url: `${site.url}${path}`,
		lastModified: new Date(),
		changeFrequency: path === "" ? "weekly" : "monthly",
		priority: path === "" ? 1 : 0.7,
	}));
}
