export type DocBlock =
	| { type: "p"; text: string }
	| { type: "ul"; items: string[] }
	| { type: "ol"; items: string[] }
	| { type: "pre"; code: string }
	| { type: "h2"; text: string }
	| { type: "note"; text: string };

export type DocPage = {
	slug: string;
	title: string;
	description: string;
	blocks: DocBlock[];
};

export const docsPages: DocPage[] = [
	{
		slug: "install",
		title: "Install",
		description: "One command on a Linux host. Docker Swarm, Traefik, Postgres, and the panel.",
		blocks: [
			{ type: "h2", text: "Quick install" },
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash`,
			},
			{ type: "h2", text: "With a domain (Let's Encrypt)" },
			{
				type: "pre",
				code: `NIXPLOY_DOMAIN=panel.example.com NIXPLOY_LETSENCRYPT_EMAIL=you@example.com \\
  curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash`,
			},
			{ type: "h2", text: "What the installer does" },
			{
				type: "ol",
				items: [
					"Installs Docker if needed and initializes Swarm",
					"Writes secrets under /etc/nixploy",
					"Pulls (or builds) the Nixploy image from GHCR",
					"Starts Postgres + Traefik + the panel",
					"Prints the setup URL for the first owner account",
				],
			},
			{ type: "h2", text: "Useful overrides" },
			{
				type: "ul",
				items: [
					"NIXPLOY_VERSION / NIXPLOY_IMAGE — pin or override the app image",
					"NIXPLOY_PORT — opt-in extra host port for plain-HTTP access (unset = Traefik only)",
					"NIXPLOY_CONFIG_DIR — config root (default /etc/nixploy)",
					"NIXPLOY_GITHUB_TOKEN — private-repo install/update",
					"NIXPLOY_SKIP_DOCKER_INSTALL=1 — use an existing Docker daemon",
				],
			},
			{ type: "h2", text: "Update" },
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash`,
			},
			{
				type: "note",
				text: "Updates keep .env, Postgres data, and Traefik ACME certs. Migrations run on boot.",
			},
		],
	},
	{
		slug: "getting-started",
		title: "Getting started",
		description: "From first login to a live service with a domain.",
		blocks: [
			{ type: "h2", text: "1. Owner setup" },
			{
				type: "p",
				text: "Open the Setup URL. A short wizard creates the owner account and organization. Public registration stays closed afterward — invite teammates from Settings → Organization.",
			},
			{ type: "h2", text: "2. Deploy something trivial" },
			{
				type: "ul",
				items: [
					"Docker image: New application → source Docker image → traefik/whoami:v1.10.1 → Domain → Deploy",
					"Template: Templates → pick a small app (e.g. Uptime Kuma) → deploy sheet → Domain",
				],
			},
			{ type: "h2", text: "3. Wire Git" },
			{
				type: "p",
				text: "Settings → Git Providers → connect GitHub / GitLab / Bitbucket / Gitea. On the app: choose the repo, enable auto-deploy, optionally Preview Deployments for PRs.",
			},
			{ type: "h2", text: "4. Automate" },
			{
				type: "ul",
				items: [
					"API key under Settings → Profile → use @nixploy/cli or curl",
					"Swagger at /swagger on your panel",
					"GitOps export/import via nixploy.yaml",
					"MCP at POST /api/mcp for AI agents",
				],
			},
		],
	},
	{
		slug: "migrate",
		title: "Migrate from Coolify or Dokploy",
		description: "No magic import — recreate services and cut DNS when green.",
		blocks: [
			{ type: "h2", text: "Approach" },
			{
				type: "ol",
				items: [
					"Install Nixploy on a fresh host (or parallel to the old one)",
					"Recreate projects / environments / services (or deploy equivalent templates)",
					"Attach domains, verify TLS and health",
					"Lower DNS TTL, flip A/AAAA records, watch traffic",
					"Decommission the old panel when stable",
				],
			},
			{ type: "h2", text: "Concept map" },
			{
				type: "ul",
				items: [
					"Coolify/Dokploy project ≈ Nixploy project + environment",
					"Application / service ≈ application, compose, or database service type",
					"Traefik labels ≈ Nixploy Domains (managed YAML, not hand-edited labels)",
					"S3 backups ≈ Destinations + backup schedules",
				],
			},
			{
				type: "note",
				text: "Deep guides live in the repo: docs/migrate-from-coolify.md and docs/migrate-from-dokploy.md.",
			},
		],
	},
	{
		slug: "deploy",
		title: "Deploy & build",
		description: "Sources, builders, queue, rollbacks, and advanced runtime options.",
		blocks: [
			{ type: "h2", text: "Sources" },
			{
				type: "ul",
				items: [
					"GitHub, GitLab, Bitbucket, Gitea (OAuth / app providers)",
					"Generic Git (HTTPS or SSH key)",
					"Docker image (public or private registry)",
					"Zip upload",
					"Compose: paste raw YAML or clone from Git",
				],
			},
			{ type: "h2", text: "Builders" },
			{
				type: "ul",
				items: [
					"Nixpacks and Railpack",
					"Dockerfile",
					"Heroku / Paketo buildpacks",
					"Static → nginx",
					"BuildKit cache for faster rebuilds",
				],
			},
			{ type: "h2", text: "Lifecycle" },
			{
				type: "ul",
				items: [
					"FIFO deploy queue with cancel and live WebSocket logs",
					"Deploy / redeploy / start / stop / reload",
					"One-click rollback to a previous successful image",
					"Swarm rolling updates — a failed deploy leaves the previous revision up",
					"Boot recovery marks interrupted deploys as failed",
				],
			},
			{ type: "h2", text: "Advanced (applications)" },
			{
				type: "ul",
				items: [
					"Mounts (volume / file content), published ports, redirects, basic-auth",
					"Healthchecks, placement constraints, replicas & resources",
					"Update / rollback Swarm configs",
				],
			},
		],
	},
	{
		slug: "domains",
		title: "Domains & TLS",
		description: "Traefik routing, Let's Encrypt, custom certificates, and free smoke hosts.",
		blocks: [
			{ type: "h2", text: "Attach a domain" },
			{
				type: "p",
				text: "On any application or compose service: Domains → add host, path, port, HTTPS. Nixploy writes Traefik dynamic config — you do not hand-edit container labels.",
			},
			{ type: "h2", text: "Certificates" },
			{
				type: "ul",
				items: [
					"Let's Encrypt (HTTP-01) when the panel / service has a real DNS name",
					"Custom certificates uploaded under Settings → Certificates",
					"None / HTTP-only for internal smoke tests",
				],
			},
			{ type: "h2", text: "traefik.me" },
			{
				type: "p",
				text: "Generate a free *.traefik.me host for local or quick demos (resolves to the client — use for smoke, not production LE).",
			},
			{ type: "h2", text: "Panel access" },
			{
				type: "p",
				text: "Settings → Platform → Access: set the dashboard domain and Let's Encrypt email. Traefik config viewer and restart live under Proxy.",
			},
		],
	},
	{
		slug: "git",
		title: "Git & preview deployments",
		description: "Provider apps, auto-deploy webhooks, and fork-gated PR previews.",
		blocks: [
			{ type: "h2", text: "Providers" },
			{
				type: "ul",
				items: [
					"GitHub App manifest flow",
					"GitLab, Bitbucket, Gitea with access tokens",
					"Webhook secrets derived per provider (reveal in Settings when needed)",
				],
			},
			{ type: "h2", text: "Auto-deploy" },
			{
				type: "p",
				text: "Push webhooks redeploy matching apps. Watch-path filters avoid rebuilding when unrelated files change. A generic org-scoped deploy hook accepts CI with an API key.",
			},
			{ type: "h2", text: "Preview deployments" },
			{
				type: "ul",
				items: [
					"PR open / sync creates or redeploys a preview with its own domain",
					"PR close tears the preview down",
					"Comments on GitHub / GitLab / Gitea with the preview URL",
					"Fork PRs require approval by default — collaborators bypass the gate",
					"Expired previews are pruned hourly",
				],
			},
		],
	},
	{
		slug: "templates",
		title: "Templates",
		description: "86+ one-click compose stacks across 15 categories.",
		blocks: [
			{ type: "h2", text: "Categories" },
			{
				type: "ul",
				items: [
					"Apps, CMS, Productivity, Analytics, Monitoring, Media",
					"Knowledge, Notifications, Finance, Developer Tools, Databases",
					"AI, Communication, Security, Storage",
				],
			},
			{ type: "h2", text: "Deploy flow" },
			{
				type: "p",
				text: "Pick a template → choose project / environment → fill env vars (secrets auto-generated where marked) → optional domain → Deploy. After deploy you own the compose file and can edit it freely.",
			},
			{
				type: "note",
				text: "Template image tags are pinned and CI-checked so catalog tags do not 404 silently.",
			},
		],
	},
	{
		slug: "databases",
		title: "Databases",
		description: "Managed Postgres, MySQL, MariaDB, MongoDB, and Redis on Swarm.",
		blocks: [
			{ type: "h2", text: "Service types" },
			{
				type: "ul",
				items: [
					"PostgreSQL, MySQL, MariaDB, MongoDB, Redis",
					"Each gets env, start/stop, logs, monitoring, and settings in the panel",
					"Credentials stored encrypted at rest",
				],
			},
			{ type: "h2", text: "Backups" },
			{
				type: "p",
				text: "Schedule dumps to an S3-compatible destination, run manually, restore from the panel, and set keep-latest retention. See Backups for volume and instance backups.",
			},
		],
	},
	{
		slug: "backups",
		title: "Backups",
		description: "Database dumps, volume archives, and instance self-backup.",
		blocks: [
			{ type: "h2", text: "Database backups" },
			{
				type: "p",
				text: "Per-database schedules → S3-compatible Destinations. Passwords never land on argv (stdin / in-container). Restore by selecting a backup key in the panel.",
			},
			{ type: "h2", text: "Volume backups" },
			{
				type: "p",
				text: "Back up named volumes attached to applications or compose services on a cron — useful for CMS uploads, Immich libraries, etc.",
			},
			{ type: "h2", text: "Instance backup" },
			{
				type: "ul",
				items: [
					"Settings → Backup storage → Instance backups",
					"pg_dump of Nixploy's own database + tar of the config dir (Traefik/ACME/SSH)",
					"Instance admin only — captures every tenant's data",
					"The config archive never includes /etc/nixploy/.env (ENCRYPTION_KEY, BETTER_AUTH_SECRET, DATABASE_URL) — back that file up separately; a restore without the original ENCRYPTION_KEY cannot decrypt stored secrets",
					"Restore is intentional/manual onto a fresh host (same ENCRYPTION_KEY)",
				],
			},
		],
	},
	{
		slug: "observability",
		title: "Observability",
		description: "Logs, metrics history, terminal, alerts, uptime, and incidents.",
		blocks: [
			{ type: "h2", text: "Live surfaces" },
			{
				type: "ul",
				items: [
					"WebSocket log streaming and deployment logs",
					"Web terminal (xterm) into running containers",
					"CPU / memory / network / block metrics with 30s samples and 48h retention",
					"Replica breakdown and 24h uptime chip",
				],
			},
			{ type: "h2", text: "Alerts & incidents" },
			{
				type: "ul",
				items: [
					"Per-service and host threshold alert rules",
					"Uptime probes with flip notifications",
					"Incident timeline on the Monitoring page",
					"Fleet overview across local and remote servers",
				],
			},
		],
	},
	{
		slug: "servers",
		title: "Servers & Docker",
		description: "Remote Swarm nodes, placement, and the Docker control center.",
		blocks: [
			{ type: "h2", text: "Remote servers" },
			{
				type: "ul",
				items: [
					"Add a host with SSH key → Setup joins the primary Swarm (worker or manager; the join and the manager role are instance-admin only)",
					"Capacity cells and drain via Docker / Swarm UI",
					"Placement constraints pin apps to node labels",
					"nixploy doctor (CLI) checks Swarm / disk / Docker health",
				],
			},
			{ type: "h2", text: "Docker control center" },
			{
				type: "p",
				text: "Admin-gated UI for containers, images, Swarm services/nodes, networks, volumes, system df/prune — operate the daemon without leaving the panel.",
			},
			{ type: "h2", text: "Platform" },
			{
				type: "ul",
				items: [
					"Private registries (self-hosted or cloud)",
					"In-app updates from GHCR",
					"Host health thresholds and cleanup crons",
				],
			},
		],
	},
	{
		slug: "security",
		title: "Auth & security",
		description: "Organizations, roles, capabilities, 2FA, audit, and encrypted secrets.",
		blocks: [
			{ type: "h2", text: "Accounts" },
			{
				type: "ul",
				items: [
					"Email/password via better-auth",
					"First user via /setup — public /register is disabled afterward",
					"Optional TOTP 2FA; org-wide require-2FA gate",
					"API keys for CLI / CI / MCP",
				],
			},
			{ type: "h2", text: "Roles & capabilities" },
			{
				type: "ul",
				items: [
					"Roles: viewer < member < deployer < admin < owner",
					"25 capability overlays (projects, secrets, domains, backups, gitops, AI, docker, …)",
					"Invite members; set per-member capability grants",
				],
			},
			{ type: "h2", text: "Hardening" },
			{
				type: "ul",
				items: [
					"Secrets in encrypted columns (AES, ENCRYPTION_KEY)",
					"Audit log for meaningful mutations",
					"Basic-auth middleware on applications",
					"Compose safety checks (no docker.sock binds, no privileged by tenants)",
				],
			},
		],
	},
	{
		slug: "schedules",
		title: "Schedules & notifications",
		description: "Cron jobs for services and multi-channel alerts.",
		blocks: [
			{ type: "h2", text: "Schedules" },
			{
				type: "p",
				text: "Run deploy or shell jobs on a cron against applications, compose stacks, remote servers, or the Nixploy host. Enable/disable and run-now from the Schedules page.",
			},
			{ type: "h2", text: "Notification channels" },
			{
				type: "ul",
				items: [
					"Slack, Discord, Telegram, email",
					"Gotify, ntfy, Pushover, Mattermost, Lark, Teams",
					"Custom webhooks",
					"Events: deploy success/fail, backups, thresholds, uptime flips, cleanup, restarts",
				],
			},
		],
	},
	{
		slug: "cli",
		title: "CLI",
		description: "@nixploy/cli — the same REST API from your terminal.",
		blocks: [
			{ type: "h2", text: "Install & login" },
			{
				type: "pre",
				code: `npm i -g @nixploy/cli
nixploy auth login --url https://panel.example.com --api-key nxlp_...
nixploy doctor`,
			},
			{ type: "h2", text: "Command groups" },
			{
				type: "ul",
				items: [
					"project — list / create",
					"app — list / create / deploy / redeploy / logs",
					"compose — list / create / deploy / logs / env / save / pull",
					"template — list / one / deploy",
					"db, env, tag, domain, server, deploy, gitops",
				],
			},
			{
				type: "note",
				text: "Credentials live in ~/.nixploy/config.json (0600). Override with --url / --api-key or NIXPLOY_API_URL / NIXPLOY_API_KEY.",
			},
		],
	},
	{
		slug: "gitops",
		title: "GitOps",
		description: "Export, plan, and apply stack desired-state as nixploy.yaml.",
		blocks: [
			{ type: "h2", text: "Flow" },
			{
				type: "ol",
				items: [
					"Export a project/environment stack to nixploy.yaml",
					"Edit or store it in Git",
					"plan — see create/update/delete diffs without applying",
					"apply — converge the live stack (redeploy changed services)",
					"syncFromUrl / syncFromGit — pull desired state into the panel",
				],
			},
			{
				type: "p",
				text: "Available in the project GitOps UI and via nixploy gitops … CLI commands.",
			},
		],
	},
	{
		slug: "mcp",
		title: "MCP",
		description: "Model Context Protocol server for AI agents that need to operate Nixploy.",
		blocks: [
			{ type: "h2", text: "Endpoint" },
			{
				type: "p",
				text: "POST /api/mcp on your panel. Authenticate with the same x-api-key header as the REST API.",
			},
			{ type: "h2", text: "Tools (examples)" },
			{
				type: "ul",
				items: [
					"list_projects, list_services, list_deployments, list_domains, list_templates",
					"get_logs, get_metrics",
					"deploy / start / stop / restart applications",
					"add_domain / remove_domain",
				],
			},
			{
				type: "note",
				text: "Full tool list and client config: docs/mcp.md in the repository.",
			},
		],
	},
	{
		slug: "ai",
		title: "Deploy Copilot",
		description: "BYO LLM key — explain failures, chat actions, and generate compose.",
		blocks: [
			{ type: "h2", text: "Setup" },
			{
				type: "p",
				text: "Settings → Platform → Copilot. Provide your own API key and model settings. Usage is gated by the ai.use capability.",
			},
			{ type: "h2", text: "What it can do" },
			{
				type: "ul",
				items: [
					"Explain failed deployments (auto on failure when enabled)",
					"Suggest env patches and redeploy with confirmation",
					"Service chat drawer with confirm-gated proposed actions",
					"Generate a docker-compose file from a prompt (preview → accept → save)",
				],
			},
		],
	},
];

export function getDocPage(slug: string): DocPage | undefined {
	return docsPages.find((p) => p.slug === slug);
}
