import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	/**
	 * `/docs/<slug>.md` serves the Markdown behind a docs page, which is what an
	 * agent following the `llms.txt` convention asks for. It has to be a rewrite:
	 * `/docs/[slug]` already owns that position and renders HTML, so the dotted
	 * URL cannot be a route segment of its own.
	 */
	async rewrites() {
		return [{ source: "/docs/:slug.md", destination: "/api/docs-md/:slug" }];
	},
};

export default nextConfig;
