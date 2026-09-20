import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	/**
	 * `/docs/<slug>.md` serves the Markdown behind a docs page, which is what an
	 * agent following the `llms.txt` convention asks for. It has to be a rewrite:
	 * `/docs/[slug]` already owns that position and renders HTML, so the dotted
	 * URL cannot be a route segment of its own.
	 */
	/*
	 * Response headers for a static marketing site. No CSP: Next injects inline
	 * styles and a bootstrap script, so a useful policy needs nonces and a
	 * dynamic response, which this site does not have — these are the ones that
	 * cost nothing and are worth having.
	 */
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "X-Frame-Options", value: "DENY" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
					},
					{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				],
			},
		];
	},

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
