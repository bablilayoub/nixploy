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
	version: "v0.4.0",
	text: "SSO configured in the panel",
	href: `${site.github}/blob/main/CHANGELOG.md`,
} as const;

/** The fold's three lines; the middle one is the emphasised one. */
export const heroTitle = ["Deploy applications", "and databases", "on servers you own"] as const;

export const heroLead =
	"Git deploys, Docker Compose stacks, five databases, domains with TLS, backups, monitoring, and an API for humans and agents. One install, Apache-2.0.";

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
export const mcpToolCount = 36;

/**
 * The feature grid: twelve cells, one claim each. Every claim maps to a
 * shipped module — git providers and builders (`deployment/sources.ts`,
 * `deployment/builders/`), compose (`modules/compose`), engines
 * (`services/kinds.ts`), Traefik (`modules/traefik`), the sampler and the
 * event timeline (`modules/monitoring`, `service_event`), backups with a
 * verified restore (`modules/backups`), previews (`modules/preview`),
 * rollback snapshots, teams/SSO/audit (`modules/projects`, `modules/auth`),
 * the REST adapter and the CLI, MCP (`modules/mcp`), the template catalog.
 * `icon` names a lucide icon; the component maps it.
 */
export const features = [
	{
		icon: "git",
		title: "Git deploys",
		text: "Push to GitHub, GitLab, Bitbucket or Gitea. nixpacks, railpack, a Dockerfile, buildpacks or static-to-nginx build it.",
	},
	{
		icon: "compose",
		title: "Docker Compose stacks",
		text: "Deploy a compose file as a stack with per-service domains, a private network and builds from source.",
	},
	{
		icon: "database",
		title: "Five databases",
		text: "Postgres, MySQL, MariaDB, MongoDB and Redis as one-click services, connection strings in the panel.",
	},
	{
		icon: "globe",
		title: "Domains and TLS",
		text: "Traefik routes every domain and issues the Let's Encrypt certificate. TCP and UDP ports route the same way.",
	},
	{
		icon: "activity",
		title: "Monitoring and alerts",
		text: "CPU, memory, network and disk per container, streamed logs, uptime probes and a per-service event timeline.",
	},
	{
		icon: "backup",
		title: "Backups that restore",
		text: "Scheduled dumps to S3 or disk, volume backups, and a restore verified in a throwaway container.",
	},
	{
		icon: "preview",
		title: "Previews per pull request",
		text: "Every pull request gets its own environment and domain. Fork pull requests wait for an approve gate.",
	},
	{
		icon: "rollback",
		title: "Rollbacks with config",
		text: "Redeploy any row of the history, or roll back to a pinned image with its environment and hooks.",
	},
	{
		icon: "team",
		title: "Teams, SSO and audit",
		text: "Roles, per-member capabilities, project-scoped teams, OIDC single sign-on and an exportable audit log. Free.",
	},
	{
		icon: "api",
		title: "REST API and CLI",
		text: "Every procedure is a REST endpoint with OpenAPI on your panel; @nixploy/cli wraps it for the terminal.",
	},
	{
		icon: "agent",
		title: "MCP for agents",
		text: `${mcpToolCount} tools through the same routers as the panel, so scope, capabilities and audit apply to an agent too.`,
	},
	{
		icon: "templates",
		title: "One-click templates",
		text: "Reviewed compose stacks with pinned images and named volumes, each asking only for the variables it needs.",
	},
] as const;

export type FeatureIcon = (typeof features)[number]["icon"];

/**
 * The tabbed product window: the full-window captures under
 * `public/screenshots/` (3200×2000, 2x), taken against a running instance on
 * 18 Sep 2026 by `tools/screenshots/capture-landing.mjs`.
 */
export const screens = [
	{
		id: "overview",
		label: "Overview",
		src: "/screenshots/02-dashboard.png",
		alt: "The organization overview: projects, services with their states, deployments in the last 24 hours, Docker containers and a deployment chart",
	},
	{
		id: "project",
		label: "Projects",
		src: "/screenshots/03-project.png",
		alt: "A project's production environment: applications, a Postgres and a Redis service with their status and domain",
	},
	{
		id: "deploy",
		label: "Deployments",
		src: "/screenshots/05-deployments.png",
		alt: "The deploy tab of a service: recent deployments with image digest, status, age and duration, each with Logs and Redeploy this commit",
	},
	{
		id: "monitoring",
		label: "Monitoring",
		src: "/screenshots/06-monitoring.png",
		alt: "The runtime tab of a database service: CPU, memory, network and disk cards above the CPU and memory charts",
	},
	{
		id: "docker",
		label: "Docker",
		src: "/screenshots/07-docker.png",
		alt: "The Docker page: containers on the host with their image, state and ports",
	},
	{
		id: "templates",
		label: "Templates",
		src: "/screenshots/07-templates.png",
		alt: "The template catalog in the panel: one-click stacks with their category and description",
	},
] as const;

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
 * The four stat cards. Templates from the generated catalog, tools from
 * `modules/mcp/tools.ts`, engines from `modules/services/kinds.ts`, the
 * control plane from `docker stats` above.
 */
export const stats = [
	{
		id: "templates",
		label: "Templates",
		value: templateCount,
		text: "Reviewed compose stacks, generated from the same catalog the panel installs from.",
	},
	{
		id: "mcp",
		label: "MCP tools",
		value: mcpToolCount,
		text: "Each one dispatches through the panel's own routers, so an agent gets exactly your permissions.",
	},
	{
		id: "databases",
		label: "Database engines",
		value: databaseEngineCount,
		text: "Postgres, MySQL, MariaDB, MongoDB and Redis, each a first-class service with backups.",
	},
	{
		id: "control-plane",
		label: "Control plane",
		value: controlPlaneTotalMib,
		unit: "MiB",
		text: `The panel, Postgres and Traefik together, measured with docker stats on the production box on ${controlPlane.measuredOn}.`,
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
