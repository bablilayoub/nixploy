import type { NextConfig } from "next";

/**
 * Baseline security headers for every panel response (pages, tRPC, REST,
 * MCP, Swagger). HSTS is added by Traefik on the dashboard router
 * (`modules/traefik/dashboard.ts`) so plain-HTTP dev never pins itself.
 *
 * `Content-Security-Policy` is deliberately `frame-ancestors` only: a full
 * policy needs a nonce pipeline for Next's inline scripts and Swagger UI —
 * tracked as follow-up in docs/status.md. Nothing in the panel embeds
 * itself in a frame, so DENY / 'none' is safe everywhere.
 */
const SECURITY_HEADERS = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
	reactStrictMode: true,
	async headers() {
		return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
	},
	// The app is served by the custom server (server.ts) — standalone output
	// keeps the production artifact self-contained.
	output: "standalone",
	// @nixploy/server ships raw TypeScript source.
	transpilePackages: ["@nixploy/server"],
	// Native / node-only deps of @nixploy/server must never be bundled.
	// Keeping these external also stops Turbopack from stuffing multi-GB
	// copies of their graphs into `.next/dev/cache` during `pnpm dev`.
	serverExternalPackages: [
		"@aws-sdk/client-s3",
		"@octokit/auth-app",
		"@octokit/webhooks",
		"adm-zip",
		"bcrypt",
		"cpu-features",
		"docker-modem",
		"dockerode",
		"node-os-utils",
		"node-pty",
		"node-schedule",
		"nodemailer",
		"octokit",
		"postgres",
		"simple-git",
		"ssh2",
		"ws",
		"yaml",
	],
};

export default nextConfig;
