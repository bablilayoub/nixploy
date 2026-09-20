import { site } from "@/lib/site";
import { templateCount } from "@/lib/templates";

/**
 * Static content for the marketing home page.
 *
 * Every number here is counted from something, never remembered, and every
 * figure says where it was read. Where the source is generated
 * (`lib/templates.ts`) the value is imported rather than written down; where
 * it is not, the comment says exactly what to re-run or re-measure. A stale
 * number on this page is a claim, not a typo.
 */

/** The fold's badge: the headline item of the latest release, linking to the changelog. */
export const heroBadge = {
	version: "v0.6.0",
	text: "DNS records created for you",
	href: `${site.github}/blob/main/CHANGELOG.md`,
} as const;

/** The fold's two lines; the second one is the quiet half of the promise. */
export const heroTitle = ["Ship anything.", "Own everything."] as const;

export const heroLead =
	"A platform as a service that runs on your own box. Git deploys, Compose stacks, five databases, domains with TLS, backups, monitoring and an API — installed in one command and licensed Apache-2.0.";

/**
 * What `docker stats` reports for the three Swarm services on the production
 * box. Re-measure with
 * `ssh nixploy docker stats --no-stream --format "{{.Name}} {{.MemUsage}}"`
 * and update `measuredOn`; do not round a stale number up or down.
 */
export const controlPlane = {
	measuredOn: "19 Sep 2026",
	services: [
		{ name: "nixploy", mib: 389 },
		{ name: "nixploy-postgres", mib: 53 },
		{ name: "nixploy-traefik", mib: 26 },
	],
} as const;

export const controlPlaneTotalMib = controlPlane.services.reduce((sum, s) => sum + s.mib, 0);

/** The five one-click engines (`modules/services/kinds.ts`, DATABASE_KINDS), with their marks. */
export const databaseEngines = [
	{ label: "PostgreSQL", slug: "postgresql" },
	{ label: "MySQL", slug: "mysql" },
	{ label: "MariaDB", slug: "mariadb" },
	{ label: "MongoDB", slug: "mongodb" },
	{ label: "Redis", slug: "redis" },
] as const;

export const databaseEngineCount = databaseEngines.length;

/** `grep -c 'name: "' packages/server/src/modules/mcp/tools.ts` */
export const mcpToolCount = 42;

/**
 * Featured templates on the home page, by id. Only ids: the name, category
 * and logo slug are read from `lib/templates.ts`, which is generated from
 * `modules/templates/data/*`, so the strip cannot advertise a template we do
 * not ship — an id that stops existing simply drops out. 49 entries, chosen
 * to span categories rather than to be the most popular.
 */
export const featuredTemplateIds = [
	"n8n",
	"openhole",
	"supabase",
	"ghost",
	"gitea",
	"nextcloud",
	"vaultwarden",
	"grafana",
	"uptime-kuma",
	"ollama",
	"plausible",
	"immich",
	"minio",
	"mattermost",
	"calcom",
	"chatwoot",
	"directus",
	"strapi",
	"portainer",
	"jellyfin",
	"keycloak",
	"authentik",
	"meilisearch",
	"excalidraw",
	"metabase",
	"paperless-ngx",
	"pihole",
	"qdrant",
	"wordpress",
	"umami",
	"outline",
	"prometheus",
	"syncthing",
	"open-webui",
	"flowise",
	"baserow",
	"hoppscotch",
	"formbricks",
	"navidrome",
	"audiobookshelf",
	"ntfy",
	"gotify",
	"listmonk",
	"actual-budget",
	"firefly-iii",
	"adguard-home",
	"wg-easy",
	"nginx-proxy-manager",
	"code-server",
] as const;

/**
 * The four numbers on the rail under the fold. Templates from the generated
 * catalog, tools from `modules/mcp/tools.ts`, engines from
 * `modules/services/kinds.ts`, the control plane from `docker stats` above.
 */
export const stats = [
	{
		id: "templates",
		label: "Templates",
		value: templateCount,
		note: "reviewed compose stacks",
	},
	{
		id: "mcp",
		label: "MCP tools",
		value: mcpToolCount,
		note: "an agent gets your permissions",
	},
	{
		id: "databases",
		label: "Database engines",
		value: databaseEngineCount,
		note: "each with backups and a restore",
	},
	{
		id: "control-plane",
		label: "MiB control plane",
		value: controlPlaneTotalMib,
		note: `panel, Postgres and Traefik, ${controlPlane.measuredOn}`,
	},
] as const;

/**
 * The half of the product that other panels put behind a plan. Every line is
 * a shipped module: SSO providers and SAML (`modules/auth/sso.ts`), teams and
 * project scope (`modules/projects`), the capability catalog, the audit log
 * with CSV export, whitelabel (`instance_branding`) and the forward-auth
 * middleware. Stated as what Nixploy includes — never as a comparison.
 */
export const openCore = [
	{
		title: "Single sign-on",
		text: "OIDC and SAML providers configured in the panel, with group-to-role mapping.",
	},
	{
		title: "Teams and project scope",
		text: "Narrow a member to the projects their teams reach. A hidden project is not found.",
	},
	{
		title: "Per-member capabilities",
		text: "A catalog of capabilities on top of the role ladder, each checked on the server.",
	},
	{
		title: "Audit log with export",
		text: "Every mutation writes a row with the actor, the IP and the organization. CSV out.",
	},
	{
		title: "Whitelabel",
		text: "Your logo, name, accent and links, on the panel and on the login page.",
	},
	{
		title: "Login in front of any domain",
		text: "Put a staging host behind your own panel's sign-in, with your 2FA policy.",
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
