/**
 * Static content for the marketing home page. Numbers mirror the product
 * (86 templates / 15 categories / 5 databases / ~300 endpoints) — update
 * them when the catalog changes.
 */

export const heroStats = [
	{ value: 86, suffix: "+", label: "one-click templates" },
	{ value: 5, suffix: "", label: "database engines, with backups" },
	{ value: 300, suffix: "+", label: "REST endpoints behind one API key" },
] as const;

/** Technologies shown in the strip under the hero (simpleicons slugs). */
export const stack = [
	{ name: "Docker Swarm", logo: "docker" },
	{ name: "Traefik", logo: "traefikproxy" },
	{ name: "Let's Encrypt", logo: "letsencrypt" },
	{ name: "PostgreSQL", logo: "postgresql" },
	{ name: "MySQL", logo: "mysql" },
	{ name: "MariaDB", logo: "mariadb" },
	{ name: "MongoDB", logo: "mongodb" },
	{ name: "Redis", logo: "redis" },
	{ name: "GitHub", logo: "github" },
	{ name: "GitLab", logo: "gitlab" },
	{ name: "Bitbucket", logo: "bitbucket" },
	{ name: "Gitea", logo: "gitea" },
	{ name: "Nixpacks", logo: "railway" },
	{ name: "Docker Compose", logo: "docker" },
] as const;

export const steps = [
	{
		title: "Connect a source",
		body: "GitHub, GitLab, Bitbucket, Gitea, any Git URL, a Docker image or a zip. Pick the branch and the builder — Nixpacks, Railpack, buildpacks, Dockerfile or static.",
	},
	{
		title: "Define environments and targets",
		body: "Group services into projects and environments with inherited variables. Pin a service to any server that joined your Swarm, set replicas, resources and health checks.",
	},
	{
		title: "Push",
		body: "The webhook fires, the build queues, the image is produced on the host and the Swarm rolls it out with zero downtime. Fork pull requests wait for your approval.",
	},
	{
		title: "Route, watch, roll back",
		body: "Traefik hot-loads the domain and issues the Let's Encrypt certificate. Logs and metrics stream live, alerts reach your channels, and any previous image is one click away.",
	},
] as const;

export const features = [
	{
		icon: "git",
		title: "Git push deployments",
		body: "Webhooks from every major provider, five builders, BuildKit cache, per-branch previews and instant rollbacks — without writing a pipeline.",
	},
	{
		icon: "layers",
		title: "Compose stacks and templates",
		body: "Paste a compose file or pick one of 86 templates. Nixploy renders, validates and deploys it as a plain stack you can edit, back up and move.",
	},
	{
		icon: "database",
		title: "Databases with real backups",
		body: "Postgres, MySQL, MariaDB, MongoDB and Redis as managed services. Scheduled dumps to any S3-compatible bucket, restore from the panel, verified exit status.",
	},
	{
		icon: "globe",
		title: "Domains and TLS",
		body: "Attach a hostname and Traefik routes it with a Let's Encrypt or custom certificate. Redirects, basic-auth and path rewrites live in the same tab.",
	},
	{
		icon: "activity",
		title: "Logs, metrics and alerts",
		body: "Live build and container logs, a web terminal, 48 hours of per-container metrics, uptime probes, incident tracking and threshold alerts.",
	},
	{
		icon: "terminal",
		title: "API, CLI and MCP",
		body: "Every panel action is a REST endpoint with OpenAPI docs, a CLI command and an MCP tool — same permissions, same audit log for humans and agents.",
	},
] as const;

export const security = [
	{
		title: "Secrets encrypted at rest",
		body: "Environment variables, database passwords, registry credentials and notification configs are AES-256-GCM encrypted and redacted for members without the secrets capability.",
	},
	{
		title: "Roles, capabilities and 2FA",
		body: "Owner to viewer roles with per-member capability overlays. Organizations can require TOTP for everyone; API keys are scoped, rate-limited per key and expire.",
	},
	{
		title: "Audit log and safe defaults",
		body: "Every destructive action is recorded with actor and target. Compose files are rendered and validated before they run, tenants get private networks, platform resources cannot be pruned.",
	},
] as const;

export const securityBadges = ["AES-256", "TOTP 2FA", "Audit log"] as const;

export const plans = [
	{
		name: "Self-hosted",
		price: "$0",
		period: "forever",
		blurb: "Everything, on a server you own. Apache-2.0, no seats, no feature gates.",
		cta: { label: "Install Nixploy", href: "/docs/install" },
		highlight: true,
		items: [
			"Unlimited projects, services and servers",
			"Git deploys, previews, rollbacks",
			"Databases, backups, instance self-backup",
			"Domains, TLS, monitoring, alerts",
			"Teams, roles, 2FA, audit log",
			"REST API, CLI, MCP, Deploy Copilot",
		],
	},
	{
		name: "Support",
		price: "Talk to us",
		period: "",
		blurb:
			"Hands-on help migrating from Dokploy, Coolify or a hand-rolled setup, and priority answers when something breaks.",
		cta: { label: "Email hello@nixploy.com", href: "mailto:hello@nixploy.com" },
		highlight: false,
		items: [
			"Migration and architecture review",
			"Priority issue handling",
			"Upgrade assistance for major releases",
			"Custom template curation",
		],
	},
] as const;

export const faqs = [
	{
		q: "Is Nixploy really free?",
		a: "Yes. Apache-2.0, no hosted tier, no license key, no seat pricing. The only bill is the server it runs on.",
	},
	{
		q: "What do I need to install it?",
		a: "One Linux host (x86_64 or arm64) with root. The installer sets up Docker, initialises Swarm, starts Postgres, Traefik and the panel, and prints your setup URL. About two minutes.",
	},
	{
		q: "What happens if a deployment fails midway?",
		a: "The previous version keeps serving. Builds run before the rollout, the Swarm update is health-checked, and a failed deploy never replaces the running tasks. Roll back to any pinned image from the Deployments tab.",
	},
	{
		q: "Can I run more than one server?",
		a: "Yes. Add servers over SSH from Settings → Servers; they join the same Swarm. Services pinned to a server are placed on that node, and metrics are sampled from every node.",
	},
	{
		q: "Does Nixploy support monorepos and compose stacks?",
		a: "Yes. Point an application at a build path inside the repository, or deploy a compose file (raw or from Git) as a stack with per-service domains and its own private network.",
	},
	{
		q: "Is there an API?",
		a: "The whole panel is an API: every procedure is a REST endpoint with OpenAPI docs on your own instance, @nixploy/cli wraps it for the terminal, and an MCP server lets AI assistants inspect and deploy with the same permissions.",
	},
] as const;
