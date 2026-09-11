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
			{ type: "h2", text: "Requirements" },
			{
				type: "ul",
				items: [
					"x86_64 or arm64 Linux with a root Docker daemon — rootless Docker is not supported",
					"Ports 80 and 443 free for Traefik",
					"2 GB RAM minimum, 4 GB+ if you build images on the host",
					"5 GB free disk on both the config directory and the Docker root",
				],
			},
			{ type: "h2", text: "What the installer does" },
			{
				type: "ol",
				items: [
					"Installs Docker if needed and initializes Swarm",
					"Runs a preflight: ports 80/443, disk, memory, rootless Docker, and your domain's DNS record against this host's public IP",
					"Writes secrets under /etc/nixploy",
					"Pulls (or builds) the Nixploy image from GHCR",
					"Starts Postgres + Traefik + the panel, then waits for GET /api/ready",
					"Prints the setup URL and the firewall one-liner for this host",
				],
			},
			{
				type: "note",
				text: "A failing preflight stops the install before anything is downloaded. NIXPLOY_SKIP_PORT_CHECK=1 and NIXPLOY_SKIP_DNS_CHECK=1 override the two that can fail on a valid setup (a proxy in front, or a CDN-backed DNS record).",
			},
			{ type: "h2", text: "Useful overrides" },
			{
				type: "ul",
				items: [
					"NIXPLOY_VERSION / NIXPLOY_IMAGE — pin or override the app image",
					"NIXPLOY_PORT — opt-in extra host port for plain-HTTP access (unset = Traefik only)",
					"NIXPLOY_CONFIG_DIR — config root (default /etc/nixploy)",
					"TZ — timezone every cron runs in (default UTC)",
					"LOG_LEVEL / LOG_FORMAT=json — panel logging",
					"NIXPLOY_GITHUB_TOKEN — private-repo install/update",
					"NIXPLOY_SKIP_DOCKER_INSTALL=1 — use an existing Docker daemon",
				],
			},
			{
				type: "note",
				text: "Every runtime knob you set in the installer's environment is added to the nixploy service, so it survives later updates. The full table is in docs/install.md → Runtime environment.",
			},
			{ type: "h2", text: "Air-gapped install" },
			{
				type: "pre",
				code: `# on a machine with network access
docker save ghcr.io/bablilayoub/nixploy:v0.2.0 postgres:17-alpine traefik:v3.5.0 \\
  | gzip > nixploy-images.tar.gz

# on the target host
docker load < nixploy-images.tar.gz
NIXPLOY_SKIP_DOCKER_INSTALL=1 NIXPLOY_PUBLIC_IP=10.0.0.5 \\
NIXPLOY_IMAGE=ghcr.io/bablilayoub/nixploy:v0.2.0 NIXPLOY_SKIP_DNS_CHECK=1 \\
  sudo -E bash install.sh`,
			},
			{ type: "h2", text: "Update" },
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash`,
			},
			{
				type: "note",
				text: "Updates keep .env, Postgres data, and Traefik ACME certs. A pg_dump is taken right before the roll (the last 3 are kept), migrations run on boot, and a new image that fails its health check is rolled back automatically.",
			},
			{ type: "h2", text: "Uninstall" },
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/uninstall.sh | sudo bash`,
			},
			{
				type: "note",
				text: "It prints what it will do and asks first. By default the Postgres volume and /etc/nixploy are kept, so re-running install.sh restores the instance; --purge deletes them after a typed confirmation.",
			},
		],
	},
	{
		slug: "troubleshooting",
		title: "Troubleshooting",
		description: "Symptom-keyed runbook for the panel, Traefik, deployments and restores.",
		blocks: [
			{
				type: "p",
				text: "Start with the readiness endpoint — it names the failing check before you read a single log line.",
			},
			{
				type: "pre",
				code: `curl -sk https://<panel-host>/api/ready | jq
docker service logs --tail 100 nixploy`,
			},
			{ type: "h2", text: "Install" },
			{
				type: "ul",
				items: [
					"Ports 80/443 in use — `ss -ltnp | grep -E ':(80|443)\\s'`, then stop nginx/Apache/Caddy. Re-runs are fine: nixploy-traefik is allowed to hold its own ports.",
					"Rootless Docker — `docker info` listing `rootless` under SecurityOptions. There is no workaround; install Docker Engine as root.",
					'Setup URL shows a private IP, or sign-in says "Invalid origin" — BETTER_AUTH_URL must be exactly the origin you browse to. Re-run with NIXPLOY_DOMAIN=… or NIXPLOY_PUBLIC_IP=….',
				],
			},
			{ type: "h2", text: "Updates" },
			{
				type: "ul",
				items: [
					"Rolled back — `docker service ps nixploy --no-trunc` names the failed task; restore the pre-update dump from /etc/nixploy/backups if a migration half-applied.",
					'/api/ready says migrations "behind" — the migration step did not finish (Postgres not up yet, or a full disk). Fix the cause, then `docker service update --force nixploy`.',
					'Deployments show "Interrupted" — expected: rolling the panel restarts the in-memory deploy queue. Nothing is corrupted; redeploy those services.',
				],
			},
			{ type: "h2", text: "TLS and domains" },
			{
				type: "ul",
				items: [
					"A domain with HTTPS off still redirects — an install from before v0.2.0 still has the entrypoint redirect in traefik.yml. Re-run update.sh; it removes the block and restarts the proxy.",
					"Stuck on the self-signed certificate — check the ACME email (not nixploy@localhost), the DNS A record, and that port 80 is reachable from the internet.",
					"Let's Encrypt rate limits — 5 failed validations per hostname per hour. Fix DNS first, then attach the domain; retrying faster makes it worse.",
					"acme.json must be mode 600 — a restore with a permissive umask is the usual way it breaks.",
					"Traefik 404s a running service — a service joins nixploy-network only while it has a domain. Re-save the domain to reconcile it.",
				],
			},
			{ type: "h2", text: "Networking and deployments" },
			{
				type: "ul",
				items: [
					"App cannot reach another service by name — since v0.2.0 each environment has its own overlay, so a service resolves only services of its own environment.",
					"ping inside a container fails — NET_RAW is dropped from tenant containers. Uptime Kuma ICMP monitors will not work; use HTTP or TCP monitors.",
					"Swarm tasks stay Pending — `docker service ps <appName> --no-trunc` prints the reason: insufficient resources, a stale placement pin, or a pruned image.",
					"A service suddenly has CPU/memory limits — org quotas are now applied as per-service resource limits when the service sets none (1024 shares = 1 CPU).",
				],
			},
			{ type: "h2", text: "Disk" },
			{
				type: "pre",
				code: `df -h /etc/nixploy && docker system df
docker image prune -f && docker builder prune -af`,
			},
			{
				type: "note",
				text: 'Never run `docker image prune -a` on a Nixploy host: a stopped application has no container, so "all unused" pruning deletes the only copy of its locally built image. Set NIXPLOY_DOCKER_CLEANUP_CRON for a safe weekly prune, and watch the disk platform alert (85% warning, 95% critical).',
			},
			{ type: "h2", text: "Restores" },
			{
				type: "ul",
				items: [
					'A restore fails with "relation already exists" — the dump predates --clean --if-exists. Drop and recreate the database, or re-dump.',
					"Everything decrypts to garbage — ENCRYPTION_KEY does not match the one that wrote the data. It lives in /etc/nixploy/.env, which is deliberately excluded from backups: keep your own copy.",
					"Rehearse before you need it: tools/dr-restore-test.sh restores into a throwaway Postgres container and can boot the panel against it.",
				],
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
					"Pre-deploy command (migrations) run before the rollout — a non-zero exit aborts the deploy and the old version keeps serving; post-deploy command run once the rollout converges",
					"Optional push of the built image to a registry, so replicas on other nodes and rollbacks after a node swap can pull it",
					"Docker-image sources can auto-update: hourly digest check, redeploy when the tag moves",
					"Boot recovery marks interrupted deploys as failed",
				],
			},
			{ type: "h2", text: "Advanced (applications)" },
			{
				type: "ul",
				items: [
					"Mounts (volume / file content), published ports, redirects, basic-auth",
					"Healthchecks, placement constraints, replicas & resources",
					"Swarm tuning: rolling update, rollback, restart policy, global mode, service labels, extra networks",
					"Watch paths — only deploy a push when a matching file changed",
					"Duplicate a service or move it to another environment",
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
					"Let's Encrypt (DNS-01) for wildcard hosts — configure a DNS provider under Settings → Platform → Wildcard certificates",
					"Custom certificates uploaded under Settings → Certificates",
					"None / HTTP-only for internal smoke tests",
				],
			},
			{ type: "h2", text: "Middlewares" },
			{
				type: "p",
				text: "Every domain — application or compose — carries an ordered list of Traefik middlewares, typed and validated by the panel (no raw YAML).",
			},
			{
				type: "ul",
				items: [
					"Rate limit (429 over the burst) and IP allow-list (403 outside the CIDRs)",
					"Headers: custom request/response headers, HSTS, CORS — Host and X-Forwarded-* stay proxy-owned",
					"Compression, sticky sessions, and maintenance mode (serve a maintenance page without touching DNS)",
					"Forward auth for an SSO proxy such as Authentik or Authelia",
					"Redirects and basic auth are available on compose services too, per compose-file service",
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
					"Preview-only environment variables, so a PR can point at a scratch database",
					"A per-application cap on simultaneous previews — over the cap the pull request gets a comment instead of a silently evicted preview",
					"A default lifetime in hours for previews a pull request creates",
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
					"Incident timeline on the Monitoring page — acknowledge and resolve",
					"Public status page at /status/<token>: chosen probes, their state, 90-day uptime and recent incident titles, on an unauthenticated link you can rotate",
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
					"Add a host with SSH key → Setup joins the primary Swarm (worker or manager; the join and the manager role are instance-admin only) and installs the pinned nixpacks / railpack builders",
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
					"Email/password via better-auth; 12-character minimum for new passwords with a live strength hint",
					"First user via /setup — public /register is disabled afterward; the installer can require a one-time setup token",
					"Optional TOTP 2FA; org-wide require-2FA gate",
					"Password reset by email, plus a break-glass host command when no mail is configured",
					"Optional OIDC single sign-on (Authentik, Keycloak, any OpenID provider) with JIT org membership",
					"Per-account sign-in lockout on top of the per-IP limit: 10 failures in 15 minutes",
				],
			},
			{ type: "h2", text: "Roles & capabilities" },
			{
				type: "ul",
				items: [
					"Roles: viewer < member < deployer < admin < owner",
					"25 capability overlays (projects, secrets, domains, backups, gitops, AI, docker, …)",
					"Invite members; set per-member capability grants",
					"Infrastructure capabilities (servers, docker, org settings, members) stay admin-only — an overlay cannot delegate them downward",
				],
			},
			{ type: "h2", text: "API keys" },
			{
				type: "ul",
				items: [
					"Scoped: read, deploy, write or full access — never more than the owner's own permissions",
					"Bound to one organization; a key cannot reach another tenant",
					"90-day expiry by default (1 year maximum), nxp_ prefix so secret scanners catch a leak, last-used per key",
					"The same scope gates REST, MCP and the deploy webhook",
				],
			},
			{ type: "h2", text: "Hardening" },
			{
				type: "ul",
				items: [
					"Secrets in encrypted columns (AES, ENCRYPTION_KEY)",
					"Audit log for meaningful mutations, including sign-in, 2FA, API-key and impersonation events",
					"Instance-admin user management: roles, bans, one-hour impersonation, every action audited",
					"Basic-auth middleware on applications",
					"Compose safety checks (no docker.sock binds, no privileged by tenants)",
				],
			},
			{ type: "h2", text: "Network isolation" },
			{
				type: "p",
				text: "Each environment gets its own private overlay network. Your services resolve each other by name inside it; another organization's containers cannot see them at all.",
			},
			{
				type: "ul",
				items: [
					"The panel and its Postgres sit on a separate overlay no tenant container ever joins",
					"A service joins the shared, Traefik-facing network only while it has a domain",
					"Managed databases publish no host port unless you opt in — reachable by name from your own environment",
					"Compose stacks keep their own per-stack network on top",
				],
			},
			{ type: "h2", text: "Container defaults" },
			{
				type: "ul",
				items: [
					"All Linux capabilities dropped, with a minimal set added back (no NET_RAW, no SYS_*)",
					"no-new-privileges on every tenant container",
					"Process (1024) and file-descriptor (65536) ceilings",
					"Rotating JSON logs (10 MB × 3) so one service cannot fill the disk",
					"Org quota CPU/memory applied as per-service limits when the service sets none",
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
		description: "@nixploy/cli — the whole panel from your terminal, scriptable.",
		blocks: [
			{ type: "h2", text: "Install & login" },
			{
				type: "pre",
				code: `npm i -g @nixploy/cli

# prompts for the key with echo off
nixploy auth login --url https://panel.example.com

# CI: pipe it in — never pass a key as an argument
echo "$NIXPLOY_API_KEY" | nixploy auth login --url https://panel.example.com

nixploy doctor`,
			},
			{ type: "h2", text: "A full deploy, scripted" },
			{
				type: "pre",
				code: `nixploy app create --project-id proj_123 --name api
nixploy app update-source app_abc --docker-image traefik/whoami:v1.10.1
nixploy app deploy app_abc
nixploy app logs app_abc -f
nixploy domain add api.example.com --application-id app_abc --port 80 --https`,
			},
			{ type: "h2", text: "Command groups" },
			{
				type: "ul",
				items: [
					"app — create, source, build type, deploy, logs -f, start/stop/restart, move, duplicate, delete",
					"compose — create, compose file get/set, deploy, logs, containers",
					"db — all five engines: create, start/stop, connection URL, external port, backups",
					"domain — add, remove, HTTPS toggle, middleware chains (rate limit, IP allow-list, headers…)",
					"env — get/set/import/export at organization, project, environment or service scope",
					"deployment — history, logs, cancel, rollback points and rollback",
					"backup — destinations, schedules, run, run history, restore, verify",
					"preview, schedule, server, registry, ssh-key, notification, incident, monitoring",
					"org, updates, audit, project, environment, template, tag, gitops",
				],
			},
			{ type: "h2", text: "Built for scripts" },
			{
				type: "ul",
				items: [
					"--json prints the raw API payload; --quiet prints identifiers for xargs",
					"Exit codes: 0 ok · 1 error · 2 usage · 3 not found or forbidden",
					"Destructive verbs require --yes",
					"--profile switches between panels and organizations",
				],
			},
			{
				type: "note",
				text: "Credentials live in ~/.nixploy/config.json (0600). Override with --url / --api-key / --profile, or NIXPLOY_API_URL / NIXPLOY_API_KEY / NIXPLOY_PROFILE.",
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
			{ type: "h2", text: "Read-only tools" },
			{
				type: "ul",
				items: [
					"list_projects, list_services, list_databases, get_database, list_templates",
					"get_service_logs, list_deployments, get_deployment_provenance (commit, author, trigger)",
					"get_env and get_resolved_env across organization → project → environment → service",
					"list_incidents, list_backups, list_backup_runs, list_previews, list_domains",
					"get_service_metrics (local and remote Swarm nodes) and get_platform_health",
				],
			},
			{ type: "h2", text: "Guarded writes" },
			{
				type: "ul",
				items: [
					"deploy / start / stop / restart applications, deploy a compose stack",
					"rollback_deployment and cancel_deployment",
					"set_env — merges variables and answers with a key-level diff",
					"add_domain / remove_domain, run_backup / verify_backup",
					"acknowledge_incident / resolve_incident",
				],
			},
			{
				type: "note",
				text: "Every tool call runs through the same tRPC routers as the panel, so organization scoping and capability checks apply unchanged — an agent can never do more than the key's user. Deleting projects, services or databases is deliberately not exposed. 32 tools; full list and client config in docs/mcp.md.",
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
