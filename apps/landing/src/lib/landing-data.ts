/**
 * Static content for the marketing home page. Numbers here mirror the
 * product (86 templates / 15 categories / 5 databases / 11 notification
 * channels / 42 routers) — update them when the catalog changes.
 */

export const stats = [
	{ value: 86, suffix: "+", label: "one-click templates" },
	{ value: 5, suffix: "", label: "database engines" },
	{ value: 11, suffix: "", label: "notification channels" },
	{ value: 300, suffix: "+", label: "REST endpoints, one API key" },
] as const;

export const heroWords = [
	"applications",
	"databases",
	"compose stacks",
	"pull requests",
	"86 templates",
];

/** Deploy log played back in the hero terminal (one line at a time). */
export const heroLog = [
	{ text: "$ git push origin main", tone: "cmd" },
	{ text: "→ webhook · api-42 queued on server-1", tone: "dim" },
	{ text: "→ nixpacks · node 22 · pnpm workspace detected", tone: "dim" },
	{ text: "→ image api-42:latest built in 38s (BuildKit cache hit)", tone: "dim" },
	{ text: "→ swarm rolling update · 3/3 replicas healthy", tone: "ok" },
	{ text: "→ traefik · api.example.com · Let's Encrypt ✓", tone: "ok" },
	{ text: "✓ live in 41s · rollback available", tone: "ok" },
] as const;

export type Tone = (typeof heroLog)[number]["tone"];

export const pipelineSteps = [
	{
		n: "01",
		title: "Connect a source",
		body: "GitHub, GitLab, Bitbucket, Gitea, any Git URL, a Docker image or a zip. Pick the branch and the builder: Nixpacks, Railpack, buildpacks, Dockerfile or static.",
	},
	{
		n: "02",
		title: "Push",
		body: "The webhook fires and the build queues per server. Fork pull requests wait for approval before anything runs on your host.",
	},
	{
		n: "03",
		title: "Roll out",
		body: "Swarm updates the service with zero downtime, Traefik hot-reloads the route, Let's Encrypt issues the cert. A failed deploy never touches the running version.",
	},
	{
		n: "04",
		title: "Watch and roll back",
		body: "Build and runtime logs stream live, metrics keep 48 h of history, alerts hit your channels. One click returns any previous image.",
	},
] as const;

export type TemplateChip = { name: string; logo: string; category: string };

/** Curated slice of the 86-template catalog (simpleicons slugs or absolute URLs). */
export const templateChips: TemplateChip[] = [
	{ name: "Supabase", logo: "supabase", category: "Databases" },
	{ name: "Plausible", logo: "plausibleanalytics", category: "Analytics" },
	{ name: "Ghost", logo: "ghost", category: "CMS" },
	{ name: "Uptime Kuma", logo: "uptimekuma", category: "Monitoring" },
	{ name: "Ollama", logo: "ollama", category: "AI" },
	{ name: "n8n", logo: "n8n", category: "Apps" },
	{ name: "MinIO", logo: "minio", category: "Storage" },
	{ name: "Vaultwarden", logo: "vaultwarden", category: "Security" },
	{ name: "Umami", logo: "umami", category: "Analytics" },
	{ name: "Metabase", logo: "metabase", category: "Analytics" },
	{ name: "Grafana", logo: "grafana", category: "Monitoring" },
	{ name: "Prometheus", logo: "prometheus", category: "Monitoring" },
	{ name: "WordPress", logo: "wordpress", category: "CMS" },
	{ name: "Strapi", logo: "strapi", category: "CMS" },
	{ name: "Directus", logo: "directus", category: "CMS" },
	{ name: "Nextcloud", logo: "nextcloud", category: "Storage" },
	{ name: "Gitea", logo: "gitea", category: "Developer Tools" },
	{ name: "Mattermost", logo: "mattermost", category: "Communication" },
	{ name: "Cal.com", logo: "caldotcom", category: "Apps" },
	{ name: "Chatwoot", logo: "chatwoot", category: "Apps" },
	{ name: "Immich", logo: "immich", category: "Media" },
	{ name: "Jellyfin", logo: "jellyfin", category: "Media" },
	{ name: "Paperless-ngx", logo: "paperlessngx", category: "Knowledge" },
	{ name: "Outline", logo: "outline", category: "Knowledge" },
	{ name: "BookStack", logo: "bookstack", category: "Knowledge" },
	{ name: "Keycloak", logo: "keycloak", category: "Security" },
	{ name: "Authentik", logo: "authentik", category: "Security" },
	{ name: "Meilisearch", logo: "meilisearch", category: "Developer Tools" },
	{ name: "Portainer", logo: "portainer", category: "Developer Tools" },
	{ name: "code-server", logo: "coder", category: "Developer Tools" },
	{ name: "Hoppscotch", logo: "hoppscotch", category: "Developer Tools" },
	{ name: "Excalidraw", logo: "excalidraw", category: "Developer Tools" },
	{ name: "Pi-hole", logo: "pihole", category: "Security" },
	{ name: "WireGuard Easy", logo: "wireguard", category: "Security" },
	{ name: "Firefly III", logo: "fireflyiii", category: "Finance" },
	{ name: "ntfy", logo: "ntfy", category: "Notifications" },
	{ name: "Listmonk", logo: "listmonk", category: "Notifications" },
	{ name: "Syncthing", logo: "syncthing", category: "Storage" },
	{ name: "Homarr", logo: "homarr", category: "Monitoring" },
	{ name: "Vikunja", logo: "vikunja", category: "Productivity" },
	{ name: "Mealie", logo: "mealie", category: "Productivity" },
	{ name: "pgAdmin", logo: "postgresql", category: "Databases" },
];

export const templateCategories = [
	"Apps",
	"CMS",
	"Productivity",
	"Analytics",
	"Monitoring",
	"Media",
	"Knowledge",
	"Notifications",
	"Finance",
	"Developer Tools",
	"Databases",
	"AI",
	"Communication",
	"Security",
	"Storage",
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
		q: "Can I run more than one server?",
		a: "Yes. Add remote servers over SSH from Settings → Servers; they join the same Swarm as workers or managers. Placement constraints decide where each service runs and metrics are sampled from every node.",
	},
	{
		q: "How do domains and TLS work?",
		a: "Point DNS at your server, attach the hostname to a service, and Traefik issues the Let's Encrypt certificate. Custom certificates, redirects and basic-auth live in the same tab. traefik.me hosts give you a working URL before you own a domain.",
	},
	{
		q: "How do I deploy from Git?",
		a: "Connect GitHub, GitLab, Bitbucket or Gitea — or paste any Git URL. Pick a branch and a builder (Nixpacks, Railpack, buildpacks, Dockerfile, static) and every push deploys. Pull requests can get their own preview URL.",
	},
	{
		q: "Is there an API?",
		a: "The whole panel is an API: every procedure is a REST endpoint with OpenAPI docs on your own instance, @nixploy/cli wraps it for the terminal, and an MCP server lets AI assistants inspect and deploy with the same permissions.",
	},
	{
		q: "How does it compare to Dokploy or Coolify?",
		a: "Same category — a self-hosted PaaS on Docker. Nixploy's differences are scope and control: Swarm-native rollouts, per-member capability overlays with 2FA enforcement and an audit log, instance self-backup, MCP + Deploy Copilot, and a REST/CLI surface that mirrors the UI one-to-one.",
	},
] as const;

export const automationSamples = {
	rest: `# create a project, deploy an app, read its logs
curl -sS -X POST https://panel.example.com/api/application.deploy \\
  -H "x-api-key: nxlp_…" -H "content-type: application/json" \\
  -d '{"applicationId":"69dd7274-…"}'

curl -sS "https://panel.example.com/api/deployment.getLogs?input=%7B%22applicationId%22%3A%22…%22%7D" \\
  -H "x-api-key: nxlp_…"`,
	cli: `$ npm i -g @nixploy/cli
$ nixploy auth login --url https://panel.example.com --api-key nxlp_…
$ nixploy app deploy 69dd7274-…
→ queued deployment 3c93bf90-…
$ nixploy app logs 69dd7274-… -f
→ image built · service updated · 3/3 healthy`,
	mcp: `{
  "mcpServers": {
    "nixploy": {
      "type": "http",
      "url": "https://panel.example.com/api/mcp",
      "headers": { "Authorization": "Bearer nxlp_…" }
    }
  }
}
// tools: list_projects · deploy_service · get_service_logs · add_domain …`,
} as const;
