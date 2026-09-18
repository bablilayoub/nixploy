/**
 * Static content for the marketing home page. Numbers mirror the product
 * (145 templates / 5 database engines / ~300 REST endpoints) — update them
 * when the catalog or the router surface changes.
 */

export const features = [
	{
		icon: "git",
		title: "Git deployments",
		body: "Deploy directly from GitHub, GitLab, Bitbucket or Gitea. Push to a branch and the build, rollout and health check run without a pipeline.",
	},
	{
		icon: "lock",
		title: "Automatic HTTPS",
		body: "Traefik and Let's Encrypt are configured for you. Attach a hostname and the certificate is issued and renewed in the background.",
	},
	{
		icon: "database",
		title: "Databases",
		body: "PostgreSQL, MySQL, MariaDB, MongoDB and Redis as managed services, with connection strings, versions and resource limits you control.",
	},
	{
		icon: "archive",
		title: "Backups",
		body: "Scheduled dumps to any S3-compatible bucket, restore from the panel, and a verified exit status so a silent empty backup cannot happen.",
	},
	{
		icon: "activity",
		title: "Monitoring",
		body: "Live build and container logs, per-container metrics, uptime probes, incident tracking and threshold alerts to your channels.",
	},
	{
		icon: "branch",
		title: "Preview deployments",
		body: "Isolated environments for branches and pull requests, each with its own domain, its own network and an expiry.",
	},
	{
		icon: "server",
		title: "Multi-server",
		body: "Add servers over SSH and they join the same Swarm. Pin a service to a node, and read metrics from every one of them.",
	},
	{
		icon: "terminal",
		title: "API, CLI and MCP",
		body: "Every panel action is a REST endpoint, a CLI command and an MCP tool — the same permissions and the same audit log for people and agents.",
	},
] as const;

/** The agent transcript in the MCP section. Tool names are real MCP tools. */
export const agentTranscript = {
	user: "Deploy the latest version of my API.",
	agent: ["Deployment created", "Build completed", "Health check passed", "Production updated"],
} as const;

/*
 * Featured templates on the home page, by id. Only ids — the name and the
 * logo slug are read from `lib/templates.ts`, which is generated from
 * `modules/templates/data/*`, so this section cannot advertise a template we
 * do not ship. An id that stops existing simply drops out of the grid.
 *
 * Chosen to span categories (apps, CMS, productivity, monitoring, AI,
 * analytics) rather than to be the twelve most popular.
 */
export const featuredTemplateIds = [
	"n8n",
	"supabase",
	"wordpress",
	"ghost",
	"gitea",
	"nextcloud",
	"vaultwarden",
	"grafana",
	"uptime-kuma",
	"ollama",
	"plausible",
	"immich",
] as const;

/**
 * Positioning, stated as what Nixploy is rather than as a comparison. The
 * sourced competitor claims live in `lib/compare.ts` and stay there.
 */
export const positioning = [
	{
		title: "Self-hosted",
		body: "The panel, the proxy and the database run on hardware you rent or own.",
	},
	{
		title: "Open source",
		body: "Apache-2.0, in the open, with no license key and no edition to upgrade to.",
	},
	{
		title: "No per-app fees",
		body: "Run one service or two hundred; the bill is the server, not the count.",
	},
	{
		title: "Your own servers",
		body: "Any Linux host with root. Add more over SSH whenever you need them.",
	},
	{
		title: "Your own data",
		body: "Databases, backups and logs stay on your disks, in your region.",
	},
	{
		title: "Your own infrastructure",
		body: "Plain Docker Swarm and Traefik underneath — inspectable, and yours to keep.",
	},
] as const;

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
			"Hands-on help migrating from another panel or a hand-rolled setup, and priority answers when something breaks.",
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
