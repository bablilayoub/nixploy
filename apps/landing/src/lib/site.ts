import pkg from "../../package.json" with { type: "json" };

/*
 * The released version, read from this app's own package.json — `tools/release.sh`
 * bumps root, web, landing and server together, so it is the release tag. It used
 * to be typed into the fold's badge and into the docs' verify-before-you-run
 * snippet, and both were left behind by the last two releases.
 */
export const version = `v${pkg.version}`;

export const site = {
	name: "Nixploy",
	url: "https://nixploy.com",
	tagline: "Ship anything. Own everything.",
	description:
		"Nixploy is a free, self-hostable Platform as a Service. Deploy apps, databases, and compose stacks on infrastructure you control — with Git deploys, Traefik TLS, monitoring, backups, GitOps, MCP, Deploy Copilot, and a first-class CLI.",
	github: "https://github.com/bablilayoub/nixploy",
	githubDocs: "https://github.com/bablilayoub/nixploy/tree/main/docs",
	githubApiDocs: "https://github.com/bablilayoub/nixploy/blob/main/docs/api.md",
	docs: "/docs",
	api: "/api",
	email: "hello@nixploy.com",
	install:
		"curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash",
	installWithDomain:
		"NIXPLOY_DOMAIN=panel.example.com NIXPLOY_LETSENCRYPT_EMAIL=you@example.com curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash",
	/** Short credit — About page only. */
	inspiredBy: "Inspired by the self-hosted deploy tools that came before — built to be better.",
} as const;
