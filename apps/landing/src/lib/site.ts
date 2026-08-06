export const site = {
	name: "Nixploy",
	url: "https://nixploy.com",
	tagline: "Ship anything. Own everything.",
	description:
		"Nixploy is a free, self-hostable Platform as a Service. Deploy apps, databases, and compose stacks on infrastructure you control — with Git deploys, Traefik TLS, monitoring, and a first-class CLI.",
	github: "https://github.com/bablilayoub/nixploy",
	docs: "/docs",
	email: "hello@nixploy.com",
	twitter: "https://x.com/nixploy",
	install:
		"curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash",
	installWithDomain:
		"NIXPLOY_DOMAIN=panel.nixploy.com NIXPLOY_LETSENCRYPT_EMAIL=you@nixploy.com curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash",
	/** Short credit — not a product comparison. */
	inspiredBy: "Inspired by Dokploy and Coolify — built to be better.",
} as const;

export const navLinks = [
	{ href: "/features", label: "Features" },
	{ href: "/docs", label: "Docs" },
	{ href: "/pricing", label: "Pricing" },
	{ href: "/about", label: "About" },
] as const;
