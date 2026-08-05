import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
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
