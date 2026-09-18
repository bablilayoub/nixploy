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
		return [
			{ source: "/docs/:slug.md", destination: "/api/docs-md/:slug" },
			/**
			 * `/nixploy-vs-<product>` is the URL people actually type and search
			 * for, and it is the canonical one every page declares. It cannot be a
			 * route folder: App Router dynamic segments are whole folder names, so
			 * `nixploy-vs-[slug]` would be a literal directory. The page lives at
			 * `/compare/[slug]` and this points the public URL at it.
			 */
			{ source: "/nixploy-vs-:slug", destination: "/compare/:slug" },
		];
	},
};

export default nextConfig;
