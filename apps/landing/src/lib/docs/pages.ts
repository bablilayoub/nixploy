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

/**
 * The public docs, hand-written from the operator guides in `docs/*.md`.
 *
 * These pages are shorter than the repository guides on purpose — they are the
 * marketing site's documentation section, not the reference. They must never
 * *contradict* `docs/`, though: when a guide changes, the matching page here
 * changes with it. `docs/` is the source of truth in every disagreement.
 *
 * Adding a page: add the slug to `nav.ts` (which drives `generateStaticParams`
 * and the sitemap) and, when the panel links to it with `<HelpLink slug="…">`,
 * to `DocSlug` in `apps/web/src/components/ui/help-link.tsx`. A unit test
 * (`help-link.test.ts` in the panel) fails when those two drift apart.
 */
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
			{ type: "h2", text: "Verify before you run it" },
			{
				type: "p",
				text: "The one-liner pipes a script into root's shell. Every release also ships a SHA256SUMS file, so the safer form is download, verify, then run.",
			},
			{
				type: "pre",
				code: `VERSION=v0.2.0
BASE="https://github.com/bablilayoub/nixploy/releases/download/$VERSION"
curl -fsSLO "$BASE/install.sh"
curl -fsSLO "$BASE/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS    # install.sh: OK
sudo bash install.sh`,
			},
			{
				type: "note",
				text: "The checksums cover the release assets, not the copies on the main branch — a release asset pins NIXPLOY_VERSION to its tag, the branch copy does not. The panel image itself is signed with cosign (keyless, GitHub OIDC); docs/install.md carries the exact cosign verify command.",
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
					"Creates the two platform overlays — nixploy-network (Traefik-facing, joined only by services that have a domain) and nixploy-internal (panel ↔ Postgres, never any tenant container)",
					"Writes secrets under /etc/nixploy (mode 600) and generates a one-time setup token",
					"Pulls (or builds) the Nixploy image from GHCR",
					"Starts Postgres + Traefik + the panel, then waits for GET /api/ready through Traefik on loopback",
					"Prints the setup URL with the token, and the firewall one-liner for this host",
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
					"NIXPLOY_MEMORY_LIMIT — memory ceiling of the panel service (default 2g)",
					"TZ — timezone every cron runs in (default UTC)",
					"LOG_LEVEL / LOG_FORMAT=json — panel logging",
					"TRUSTED_PROXIES — set to 1 by the installer so the real client IP is read from X-Forwarded-For behind Traefik. Without it every client IP reads as unknown and the IP-based rate limits collapse into one shared bucket",
					"NIXPLOY_GITHUB_TOKEN — private-repo install/update",
					"NIXPLOY_SKIP_DOCKER_INSTALL=1 — use an existing Docker daemon",
				],
			},
			{
				type: "note",
				text: "Every runtime knob you set in the installer's environment is added to the nixploy service, so it survives later updates. The full table is in docs/install.md → Runtime environment.",
			},
			{ type: "h2", text: "Deadlines and retention" },
			{
				type: "ul",
				items: [
					"NIXPLOY_COMMAND_TIMEOUT_MS — every local shell/Docker command (default 30 minutes); NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS is the SSH equivalent",
					"NIXPLOY_DEPLOY_TIMEOUT_MS — per-deployment deadline (default 60 minutes); the job is cancelled and the row fails",
					"NIXPLOY_CONVERGENCE_TIMEOUT_MS — how long a rollout may take to produce one running task (default 180 seconds)",
					"NIXPLOY_HOOK_TIMEOUT_MS — pre/post-deploy hooks and image jobs (default 10 minutes)",
					"NIXPLOY_METRICS_RETENTION_HOURS — metrics history window (default 48, maximum 720)",
					"NIXPLOY_AUDIT_RETENTION_DAYS — audit log retention (default 365, 0 keeps rows forever)",
					"NIXPLOY_DEPLOY_CONCURRENCY — deploy jobs built in parallel per target server (default 1)",
				],
			},
			{ type: "h2", text: "Split worker (optional)" },
			{
				type: "p",
				text: "By default Nixploy is one process: UI, API, websockets, the deploy queue and every cron share a memory limit. --split-worker moves the background half into its own Swarm service, nixploy-worker.",
			},
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh \\
  | sudo bash -s -- --split-worker

# collapse back to one process
sudo bash install.sh --no-split-worker`,
			},
			{
				type: "ul",
				items: [
					"nixploy runs with NIXPLOY_ROLE=panel — UI, tRPC, REST, MCP, websockets; it still enqueues deploys and writes per-domain Traefik YAML",
					"nixploy-worker runs with NIXPLOY_ROLE=worker — the deploy claim loop, boot recovery, every cron, and /api/health, /api/ready, /api/version",
					"Updating the panel stops interrupting builds: a panel restart closes sockets in milliseconds while the worker keeps building",
					"Separate memory ceilings (NIXPLOY_MEMORY_LIMIT and NIXPLOY_WORKER_MEMORY), so a 2 GB build cannot OOM the UI",
					"The two halves coordinate over Postgres LISTEN/NOTIFY — no broker, no extra port, no schema change",
				],
			},
			{
				type: "note",
				text: "The worker owns the migrations, so update.sh rolls it first. Deploy and cron output moves to docker service logs -f nixploy-worker. Re-running install.sh keeps the split without repeating the flag.",
			},
			{ type: "h2", text: "Health endpoints" },
			{
				type: "ul",
				items: [
					"GET /api/health — liveness, no dependencies",
					"GET /api/ready — per-check readiness (database, Docker socket, migration state, deploy queue, Traefik, platform alerts); 503 with the failing checks listed",
					"GET /api/version — version, commit, Node and Next versions for nixploy doctor and support",
				],
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
				text: "Updates keep .env, Postgres data, and Traefik ACME certs. A pg_dump is taken right before the roll (the last 3 are kept), migrations run on boot, and a new image that fails its /api/ready health check is rolled back automatically. On a split install both services are rolled, worker first.",
			},
			{
				type: "ul",
				items: [
					"Settings → Platform → Updates shows the GitHub release notes for the image the instance tracks, not just a digest",
					"Update to a specific release: only the tag changes, never the registry or repository the instance already trusts",
					"pinnedVersion is a ceiling for automatic updates — the checker logs “held back” instead of rolling past it",
					"Downgrades are refused unless you allow them explicitly: migrations are forward-only, so restore the pre-update dump first",
				],
			},
			{ type: "h2", text: "Uninstall" },
			{
				type: "pre",
				code: `curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/uninstall.sh | sudo bash`,
			},
			{
				type: "note",
				text: "It prints what it will do and asks first. By default it removes the platform services (including nixploy-worker on a split install) and the two overlays, keeping the Postgres volume and /etc/nixploy — so re-running install.sh restores the instance. --purge deletes them after a typed confirmation; --tenants also removes your deployed services, which are otherwise left running.",
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
				text: "Open the Setup URL the installer printed. It carries a one-time setup token (?token=…) so a scanner cannot win the race for the first admin account on a fresh host. A short wizard creates the owner account and organization; public registration stays closed afterward.",
			},
			{
				type: "p",
				text: "Teammates join through a shareable invite link from Settings → Organization — no SMTP required. The link discloses only a masked email; the invitee types the address to prove they are the right recipient.",
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
					"API key under Settings → Profile — pick the narrowest scope (read, deploy, write or admin)",
					"Swagger at /swagger on your panel",
					"GitOps export/import via nixploy.yaml",
					"MCP at POST /api/mcp for AI agents",
				],
			},
			{ type: "h2", text: "5. Optional power features" },
			{
				type: "ul",
				items: [
					"Deploy Copilot — Settings → Platform → Copilot, with your own LLM key",
					"Shared variables — Settings → Organization, inherited by every project, environment and service",
					"Single sign-on — set NIXPLOY_OIDC_ISSUER / CLIENT_ID / CLIENT_SECRET and /login grows a Continue with … button",
					"Remote servers — Settings → Servers, joined to the same Swarm over SSH",
					"Watch paths — only deploy a push when a matching file changed",
				],
			},
		],
	},
	{
		slug: "migrate",
		title: "Migrate from another panel",
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
					"A project elsewhere ≈ Nixploy project + environment",
					"Application / service ≈ application, compose, or database service type",
					"Traefik labels ≈ Nixploy Domains (managed YAML, not hand-edited labels)",
					"S3 backups ≈ Destinations + backup schedules",
					"Compose stacks you already have ≈ a compose service (paste the file, clone it from Git, or point at a raw URL)",
				],
			},
			{
				type: "note",
				text: "One difference worth planning for: each environment gets its own private overlay network, so a service resolves only services of its own environment. Put things that talk to each other in one environment. The deep guide lives in the repo: docs/migrate-from-another-panel.md.",
			},
		],
	},
	{
		slug: "deploy",
		title: "Deploy & build",
		description: "Sources, builders, the durable queue, hooks, rollbacks and runtime options.",
		blocks: [
			{ type: "h2", text: "Sources" },
			{
				type: "ul",
				items: [
					"GitHub, GitLab, Bitbucket, Gitea (OAuth / app providers)",
					"Generic Git (HTTPS or SSH key)",
					"Docker image (public or private registry)",
					"Zip upload",
					"Compose: paste raw YAML, clone from Git, or create from a raw compose URL",
				],
			},
			{ type: "h2", text: "Builders" },
			{
				type: "ul",
				items: [
					"Nixpacks and Railpack",
					"Dockerfile",
					"Heroku / Paketo buildpacks (amd64-only images — prefer nixpacks, railpack or Dockerfile on arm64)",
					"Static → nginx",
					"BuildKit cache for faster rebuilds",
				],
			},
			{
				type: "note",
				text: "Builders receive only the application's build args — the merged runtime env goes to the Swarm service alone, so a runtime secret no longer gets baked into image layers or the BuildKit cache. Move any key a build genuinely needs into Build args. Secret-looking keys in a Dockerfile build become BuildKit --secret mounts, which never appear in docker history.",
			},
			{ type: "h2", text: "The queue" },
			{
				type: "ul",
				items: [
					"Durable: the deployment table is the queue, so a restart, a crash or a SIGKILL mid-build never loses the backlog — queued rows are simply claimed on the next boot",
					"Statuses are queued → running → done | error | cancelled, streamed live over a WebSocket",
					"FIFO per target server, with a per-app mutex: two jobs for one service never build at once",
					"A burst of pushes coalesces — the older queued row is superseded (and reported as cancelled, not as a failure), so at most one running plus one queued job per app",
					"Cancel from the UI or the CLI; boot recovery fails deployments a restart interrupted",
					"Deploy concurrency is per server (NIXPLOY_DEPLOY_CONCURRENCY, default 1)",
				],
			},
			{ type: "h2", text: "Lifecycle" },
			{
				type: "ul",
				items: [
					"Deploy / redeploy / start / stop / reload",
					"Swarm rolling updates — a failed deploy leaves the previous revision up",
					"A convergence gate waits for one task to actually reach running (after the image's HEALTHCHECK) before the deploy is called successful; three failed tasks fail it with the engine's reason",
					"One-click rollback to a previous successful image — the newest 5 pins per app are kept",
					"Compose rollback restores the stack's compose file and its service-level env from a snapshot taken at each render",
					"Optional push of the built image to a registry, so replicas on other nodes and rollbacks after a node swap can pull it",
					"Docker-image sources can auto-update: hourly digest check, redeploy when the tag moves",
				],
			},
			{ type: "h2", text: "Deploy hooks" },
			{
				type: "p",
				text: "A pre-deploy command (migrations, say) runs in a throwaway container built from the image this job just produced, with the merged runtime env handed over a 0600 env file — never on argv. A non-zero exit aborts the deploy before the rollout, so the old version keeps serving. The post-deploy command runs once the rollout converges.",
			},
			{
				type: "ul",
				items: [
					"The image must contain a shell: the hook overrides the image's own ENTRYPOINT with sh, and exit 127 means there is no /bin/sh (scratch and distroless images cannot host one)",
					"Hooks are time-boxed by NIXPLOY_HOOK_TIMEOUT_MS (default 10 minutes); the container and the env file are always cleaned up",
					"Previews never run them — a pull request's migration must not touch the environment production shares",
				],
			},
			{ type: "h2", text: "Provenance" },
			{
				type: "p",
				text: "Every deployment records what started it (manual, api, webhook, schedule, preview, rollback, redeploy, gitops, system) and who. Push webhooks fill in the commit SHA, message and author; after a checkout the worker reads them from git when the payload did not carry them, and a docker-image source stores the registry digest. The history table renders the trigger, the short SHA linked to the provider's commit page, and the author.",
			},
			{ type: "h2", text: "Advanced (applications)" },
			{
				type: "ul",
				items: [
					"Mounts (volume / file content), published ports, redirects, basic auth",
					"Healthchecks, placement constraints, replicas & resources",
					"Swarm tuning: rolling update, rollback, restart policy, global mode, service labels, extra networks",
					"Watch paths — only deploy a push when a matching file changed",
					"Duplicate a service or move it to another environment",
				],
			},
			{
				type: "note",
				text: "Overriding the container hardening baseline (dropped capabilities, no-new-privileges) or the Swarm network list is instance-admin only — see Auth & security.",
			},
		],
	},
	{
		slug: "domains",
		title: "Domains & TLS",
		description: "Traefik routing, Let's Encrypt, wildcards, middlewares and free smoke hosts.",
		blocks: [
			{ type: "h2", text: "Attach a domain" },
			{
				type: "p",
				text: "On any application or compose service: Domains → add host, path, container port, HTTPS. Nixploy writes Traefik dynamic config — you do not hand-edit container labels. A service joins the shared, Traefik-facing network only while it has at least one domain, and the attachment is reconciled on every domain change.",
			},
			{
				type: "ul",
				items: [
					"The container port is the port your app listens on inside the container. An empty port is the number-one cause of 502s, so the form requires it",
					"Internal path rewrites the prefix — public /public/* can reach the container as /internal/*",
					"A host is one namespace for the whole instance: a host another organization already routes is refused, so nobody can hijack a route",
				],
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
			{
				type: "note",
				text: "New Let's Encrypt domains are capped at 20 per organization per hour: the instance shares one ACME account, so hosts that do not resolve burn the whole box's budget. Wildcard rows (*.apps.example.com) are instance-admin only — Nixploy cannot prove an organization owns the parent zone, and a wildcard swallows every unclaimed subdomain of it. Traefik reads DNS-01 provider credentials from its own environment, so one docker service update --env-add on the host is needed; the settings card prints the exact command.",
			},
			{ type: "h2", text: "HTTPS is per domain" },
			{
				type: "p",
				text: "There is no entrypoint-level HTTP → HTTPS redirect any more: it overrode every domain's own toggle. A domain with HTTPS on gets a per-router redirect middleware; a domain with HTTPS off is served plain on :80, which is what the toggle was always supposed to mean. The panel's own router stays HTTPS-only.",
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
					"Headers: custom request/response headers, HSTS, CORS — Host and X-Forwarded-* stay proxy-owned and are rejected",
					"Compression, sticky sessions, and maintenance mode (serve a maintenance page without touching DNS or the certificate)",
					"Forward auth for an SSO proxy such as Authentik or Authelia",
					"Redirects and basic auth are available on compose services too, per compose-file service",
				],
			},
			{
				type: "note",
				text: "Chain order is internal-path rewrite → app-wide redirects → basic auth → the domain's middlewares. Disabling a row keeps it stored but leaves it out of the rendered YAML, and the chain is reloaded on every deploy so a deploy no longer wipes it.",
			},
			{ type: "h2", text: "TCP and UDP" },
			{
				type: "p",
				text: "A domain is an HTTP route by default. Set its Protocol to TCP or UDP and Traefik forwards the raw stream on a dedicated entrypoint instead — see TCP & UDP routing.",
			},
			{ type: "h2", text: "traefik.me" },
			{
				type: "p",
				text: "Generate a free *.traefik.me host for local or quick demos (it resolves to 127.0.0.1 — use it for smoke tests, not for production Let's Encrypt).",
			},
			{ type: "h2", text: "Panel access" },
			{
				type: "p",
				text: "Settings → Platform → Access: set the dashboard domain and Let's Encrypt email. Once a dashboard domain is configured the low-priority catch-all router is dropped, so the panel answers on its own host only instead of on every hostname pointed at the box. Traefik's config viewer and restart live under Proxy.",
			},
		],
	},
	{
		slug: "tcp-udp-routing",
		title: "TCP & UDP routing",
		description: "Layer-4 routes through Traefik: entrypoints, HostSNI, TLS modes.",
		blocks: [
			{
				type: "p",
				text: "Postgres, Redis, SMTP, a game server, a DNS resolver — anything that is not HTTP can still go through the proxy. Set a domain's Protocol to TCP or UDP and Traefik forwards the raw stream instead of parsing requests.",
			},
			{ type: "h2", text: "Entrypoints" },
			{
				type: "p",
				text: "Layer-4 routing needs a dedicated entrypoint, because Traefik cannot tell two TCP services apart on one port unless they use TLS with SNI. Settings → Server → TCP and UDP entrypoints (instance admin only) defines one: a name, a port and a protocol, for example pg-15432 on 15432/tcp.",
			},
			{
				type: "ul",
				items: [
					"The entrypoint is written into Traefik's static configuration and the port is published on the proxy service",
					"Host ports are one shared namespace across tenants, which is why entrypoints are instance-level",
					"Privileged ports, the well-known database ports and the platform's own ports are rejected",
					"Deleting an entrypoint is refused while a domain still routes through it",
					"web (:80) and websecure (:443) are reserved built-ins and cannot be used by a tcp/udp domain",
				],
			},
			{
				type: "note",
				text: "Both halves of that change restart the proxy — Traefik reads its static configuration once at start, and a published-port change recreates the task anyway. Nixploy issues a single update so it happens once, but every route on the instance is unavailable for a few seconds (~9 s measured on a local swarm). Plan an entrypoint change like a restart, not like a config edit.",
			},
			{ type: "h2", text: "TLS modes" },
			{
				type: "p",
				text: "A TCP router can only match on the hostname in the TLS handshake (SNI). The domain's TLS setting decides both the rule and what Traefik does with the stream.",
			},
			{
				type: "ul",
				items: [
					"None — the router matches everything on that entrypoint and the host you typed is ignored, so one entrypoint serves exactly one service. This is what you want for Postgres, Redis or MySQL (and a wildcard host is refused, because there is nothing to match on)",
					"Terminate — Traefik presents the certificate (Let's Encrypt, custom or the self-signed default) and speaks plaintext to the container, so several services can share one port, told apart by SNI",
					"Passthrough — the encrypted stream is forwarded untouched and the backend owns the certificate; Traefik never sees plaintext",
					"UDP has no TLS and no rule at all — the entrypoint is the match, so one UDP entrypoint serves one service",
				],
			},
			{ type: "h2", text: "What does not apply" },
			{
				type: "p",
				text: "Paths, internal-path rewrites, redirects, basic auth, the HTTPS toggle and the whole middleware chain are HTTP concepts. The domain form hides them for tcp/udp rows and the server rejects them rather than ignoring them, so a route never silently does less than the form suggested.",
			},
			{ type: "h2", text: "Databases" },
			{
				type: "p",
				text: "A managed database still has its own external port (Settings → General on the database), which publishes the port directly on the host and does not involve Traefik at all. Reach for a TCP domain when you want several services behind one port with SNI, or when the database is an application or compose service you deploy yourself.",
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
				text: "Push webhooks redeploy matching apps, with the signature verified and watch-path filters applied so unrelated files do not trigger a rebuild. A generic org-scoped deploy hook accepts CI with an API key, under the same key scope and 2FA gate as the REST API.",
			},
			{ type: "h2", text: "Preview deployments" },
			{
				type: "ul",
				items: [
					"PR open / sync creates or redeploys a preview with its own domain",
					"PR close tears the preview down",
					"Comments on GitHub / GitLab / Gitea carry the preview URL and are edited in place on later pushes, instead of stacking",
					"Fork PRs require approval by default — collaborators on the base repo bypass the gate, and an unreachable membership check fails safe toward requiring approval",
					"Preview-only environment variables, merged over the service layer, so a PR can point at a scratch database",
					"A per-application cap on simultaneous previews — over the cap the pull request gets a comment instead of a silently evicted preview",
					"A default lifetime in hours for previews a pull request creates; expired previews are pruned hourly",
					"Previews carry the PR's commit metadata in their deployment history like any other build",
				],
			},
			{
				type: "note",
				text: "A preview runs the parent's image and merged env, but none of its published ports, volumes or file mounts, as a single replica. Deploy hooks never run for a preview. Compose services have no previews.",
			},
		],
	},
	{
		slug: "templates",
		title: "Templates",
		description: "145 one-click compose stacks across 15 categories, plus your own catalogs.",
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
				text: "Template image tags are pinned and CI-checked so catalog tags do not 404 silently. Templates that need host privileges (a mounted Docker socket, extra capabilities) can only be deployed and later edited by the instance admin.",
			},
			{ type: "h2", text: "Bring your own catalog" },
			{
				type: "p",
				text: "The built-in catalog ships with the image, so it only changes with a release. Settings → Templates adds your own sources, scoped to one organization and managed by an org admin or owner.",
			},
			{
				type: "ul",
				items: [
					"http-json — one JSON document: a bare array of templates, or { templates: [ … ] }",
					"git — a repository whose templates/index.json has the same shape, cloned shallow and discarded",
					"Nothing is fetched while browsing: Sync now does the work and caches the result on disk with mode 0600",
					"A bad entry is dropped with a reason rather than taking the whole catalog offline; an image tag that cannot be confirmed anonymously is a warning, not a rejection",
					"Remote ids are namespaced by their source, so a source can never shadow a built-in template, and hostPrivileged is never accepted from a remote catalog",
				],
			},
			{ type: "h2", text: "Deploy from a compose URL" },
			{
				type: "p",
				text: "A raw compose file at an http(s) URL can be turned straight into a compose service. The URL goes through the same outbound guard as everything else, the body through the same safety checks a pasted file gets, and nothing is deployed until you say so. Give it the raw file URL — redirects are not followed, and an HTML response (a repository page instead of the raw file) is rejected with that message.",
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
					"Each gets env, start/stop, logs, monitoring, backups and settings in the panel",
					"Credentials are generated server-side and stored encrypted at rest",
					"MongoDB replica sets are not supported — a single-node set never started, so the option is refused rather than silently broken",
				],
			},
			{ type: "h2", text: "Version picker" },
			{
				type: "p",
				text: "General → Version offers a short list of curated tags per engine with an end-of-life note where one applies, and fills the Docker image field for you. Custom image… unlocks the field again for a variant, a fork or a pinned digest.",
			},
			{
				type: "ul",
				items: [
					"Downgrades are refused: the volume is already written in the newer on-disk format and the container would crash-loop. Create a new service on the older version and restore a backup into it",
					"Major upgrades ask for a confirmation — Postgres in particular will not start on a data directory initialised by an older major, so take a backup first",
					"Bumps inside one major, and any Redis change, go through without a prompt",
					"Postgres 18 changed its image layout; Nixploy pins PGDATA inside the mounted volume so an upgrade cannot silently start an empty cluster",
					"The image only takes effect on the next Reload",
				],
			},
			{ type: "h2", text: "Additional databases" },
			{
				type: "p",
				text: "One instance can host more than one logical database. Connection → Additional databases creates a database plus an owning user inside the running container — a role and database on Postgres, a database with a granted user on MySQL/MariaDB, a dbOwner user on MongoDB. Redis is not offered: it has one keyspace.",
			},
			{
				type: "ul",
				items: [
					"The service must be running: Nixploy reaches the engine with docker exec, never over the network",
					"The password is generated server-side, stored encrypted, and redacted for members without the secrets.read capability",
					"Names are restricted and engine-owned names are rejected; the SQL is piped over stdin so no password appears in ps on the host",
					"Deleting drops the database and its user, with no undo — and scheduled backups only cover the primary database",
				],
			},
			{ type: "h2", text: "Reaching a database" },
			{
				type: "p",
				text: "Prefer the internal URL (<appName>:5432) from services in the same environment. A managed database publishes no host port unless you set one, and it never joins the shared, Traefik-facing network.",
			},
			{
				type: "note",
				text: "Swarm's host-mode publishing binds every interface — there is no loopback-only form — so an external port is a real internet-facing listener. Privileged ports, the well-known database ports and the platform's own ports are refused; firewall the rest at the host and keep the generated password. For several TCP services behind one port with SNI, use a TCP domain instead.",
			},
			{ type: "h2", text: "Backups" },
			{
				type: "p",
				text: "Schedule dumps to an S3-compatible or local destination, run them manually, check the run history, verify a stored dump into a throwaway container, restore from the panel, and set keep-latest retention. Redis is dumped with BGSAVE and the whole data directory (RDB plus the AOF) is archived. See Backups for volume and instance backups.",
			},
		],
	},
	{
		slug: "backups",
		title: "Backups",
		description: "Database dumps, volume archives, run history, and instance self-backup.",
		blocks: [
			{ type: "h2", text: "Destinations" },
			{
				type: "ul",
				items: [
					"S3-compatible buckets — anyone with the destinations.manage capability can add one",
					"Local disk on the panel host — instance admin only, needs a name and nothing else",
					"Archives are written write-then-rename, so a crash mid-write never leaves a truncated file that retention would count as a good backup",
					"A lost host takes local backups with it: keep an off-host copy of anything you actually rely on",
				],
			},
			{ type: "h2", text: "Database backups" },
			{
				type: "p",
				text: "Per-database schedules write to a destination on a cron. Passwords never land on argv (stdin or in-container), a failed dump fails the run instead of uploading an empty archive, and restores stream the stored object back into the container over stdin — so there is no size ceiling on a dump any more.",
			},
			{ type: "h2", text: "Run history and verification" },
			{
				type: "ul",
				items: [
					"Every dump, archive, instance export and verification is one run row: running first, then success with the object key and size, or error with a redacted message safe to show and to notify on",
					"Each list badges its rows with the last run; the history icon opens the last 20 with status, trigger, duration, size and the stored object",
					"Verify restores a stored dump into a throwaway container from the service's own image — no published ports, no network, no real credentials — runs a liveness query and removes it. It never touches the live database",
					"A failed verification is visible in the history next to the dump it rejected",
				],
			},
			{ type: "h2", text: "Volume backups" },
			{
				type: "p",
				text: "Back up named volumes attached to applications or compose services on a cron — useful for CMS uploads, media libraries and anything a SQL dump does not cover.",
			},
			{ type: "h2", text: "Instance backup" },
			{
				type: "ul",
				items: [
					"Settings → Backup storage → Instance backups",
					"Two artifacts per run: a pg_dump of Nixploy's own database and a tar of the config dir (Traefik config, acme.json, SSH keys)",
					"Instance admin only to create, edit, run or delete — the dump captures every tenant's data",
					"The config archive never includes /etc/nixploy/.env (ENCRYPTION_KEY, BETTER_AUTH_SECRET, DATABASE_URL) — shipping the key next to the data it protects would hand every tenant credential to anyone who can read the bucket",
					"Restore is intentional and manual, onto a fresh host, with the same ENCRYPTION_KEY",
				],
			},
			{
				type: "note",
				text: "Back up /etc/nixploy/.env yourself, somewhere the bucket reader cannot reach. A restore without the original ENCRYPTION_KEY cannot decrypt anything stored — env vars, database passwords, registry/git/SSH credentials, S3 keys and notification configs all have to be re-entered by hand.",
			},
			{ type: "h2", text: "Rehearse the restore" },
			{
				type: "p",
				text: "The first real restore should not be the first restore. tools/dr-restore-test.sh in the repository restores a dump into a throwaway Postgres container, restores a second time to prove the dump applies over a populated database, asserts the core tables, and can boot the panel image against the result. Run it monthly, after a Postgres major upgrade, and after changing a destination.",
			},
		],
	},
	{
		slug: "observability",
		title: "Observability",
		description: "Logs, metrics history, Prometheus, terminal, alerts, uptime, and incidents.",
		blocks: [
			{ type: "h2", text: "Live surfaces" },
			{
				type: "ul",
				items: [
					"WebSocket log streaming and deployment logs, with level badges, filtering and download",
					"Web terminal (xterm) into running containers",
					"CPU / memory / network / block metrics sampled every 30 seconds, kept for 48 hours by default (NIXPLOY_METRICS_RETENTION_HOURS, up to 720)",
					"Replica breakdown and a 24h uptime chip",
					"A single push stream per tab updates deployment status, queue depth and service-status corrections, so dashboard screens carry no polling of their own",
				],
			},
			{ type: "h2", text: "Prometheus" },
			{
				type: "p",
				text: "GET /api/metrics serves the calling API key's organization as Prometheus text exposition. A scrape is a read, so a read-only key is enough, and the same rate limits, key scopes and organization binding apply as everywhere else.",
			},
			{
				type: "pre",
				code: `curl -H "x-api-key: $NIXPLOY_API_KEY" https://panel.example.com/api/metrics`,
			},
			{
				type: "ul",
				items: [
					"Series: service CPU, memory and memory limit, service status, deployments by status, uptime probe state, and this process's queue depth",
					"Numbers come from the existing metrics store, so scraping faster than the 30-second sampler just sees the same point twice",
					"Services with no sample yet emit no CPU/memory series; the status gauge is always emitted, so status == 0 is the honest “it is down” signal",
					"One organization per key — there is deliberately no instance-wide dump that would expose every tenant's names",
				],
			},
			{ type: "h2", text: "Alerts & incidents" },
			{
				type: "ul",
				items: [
					"Per-service and host threshold alert rules",
					"Uptime probes with flip notifications",
					"Incident timeline on the Monitoring page — acknowledge records who is looking at it and leaves the incident open; resolve closes it with an optional note",
					"Public status page at /status/<token>: chosen probes, their state, 90-day uptime and recent incident titles, on an unauthenticated link you can rotate or take offline",
					"Fleet overview across local and remote servers",
				],
			},
			{
				type: "note",
				text: "What the status page exposes is deliberately small: the probe's host, its state, an uptime percentage and incident titles. No service ids, project names, probe paths, error strings or acknowledger identities. The page is noindex and rate-limited per IP.",
			},
			{ type: "h2", text: "Platform self-alerts" },
			{
				type: "p",
				text: "Organization thresholds watch tenant services; platform self-alerts watch the box the panel runs on, so an operator learns about a full disk from Slack instead of from a failed deploy. A check runs every five minutes.",
			},
			{
				type: "ul",
				items: [
					"Host disk above 85% (warning) or 95% (critical) on the filesystem holding the config dir",
					"The oldest deployment still queued for more than 30 minutes",
					"An ACME certificate expiring in under 14 days, or already expired",
					"Traefik or Postgres below their desired replicas",
					"No successful instance backup in NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS days (default 8, 0 disables)",
				],
			},
			{
				type: "note",
				text: "They go to notification channels that have the “Nixploy restarted” toggle on and belong to an organization with an instance-admin member — a tenant org that enables the toggle never sees platform internals. One notification per alert per 24 hours, also surfaced on GET /api/ready and on Monitoring → Fleet.",
			},
			{ type: "h2", text: "Panel logs" },
			{
				type: "ul",
				items: [
					"docker service logs -f nixploy — one line per event, prefixed with the subsystem in brackets ([deploy], [status-reconciler], [metrics-history], [platform-alerts], …)",
					"LOG_LEVEL is debug | info | warn | error; LOG_FORMAT=json emits one JSON object per line for Loki, Elastic or Datadog",
					"All three platform services rotate their json-file logs (10 MB × 3), so an unbounded log cannot fill a small host",
					"Build logs are not process logs: each deployment writes its own file under the config dir, streamed live to the UI and pruned after 30 days",
					"Secrets never reach the log — a line that contains a credential is a bug worth reporting",
				],
			},
		],
	},
	{
		slug: "servers",
		title: "Servers & Docker",
		description: "Remote Swarm nodes, placement, SSH transport, and the Docker control center.",
		blocks: [
			{ type: "h2", text: "Remote servers" },
			{
				type: "ul",
				items: [
					"Add a host with an SSH key → Setup joins the primary Swarm (worker or manager; the join and the manager role are instance-admin only) and installs the pinned nixpacks / railpack builders",
					"Services pinned to a server carry a node.id placement constraint, so their tasks land where the image and the data volume live",
					"Swarm service objects are always issued to the primary manager; everything that happens on the node itself — builds, image pulls, container exec, logs, stats, plain docker compose — goes over SSH",
					"Capacity cells and drain via the Docker / Swarm UI; placement constraints pin apps to node labels",
					"Metrics history covers remote services too, collected in one SSH batch per server with a per-server enable switch and cadence",
					"nixploy doctor (CLI) checks Swarm / disk / Docker health",
				],
			},
			{ type: "h2", text: "SSH transport" },
			{
				type: "ul",
				items: [
					"One pooled connection per server carries every channel — shell commands, builds, the Docker engine API, logs and stats — instead of a handshake per call",
					"Keepalives notice a silently dropped link, and an idle connection closes itself and is re-dialled on demand",
					"A circuit breaker marks a server unreachable after repeated connection failures and fails fast for a few minutes, naming the server and when Nixploy will retry. One success, Test connection or re-running Setup closes it",
					"Cron passes group work by server and run a bounded number in parallel, so one dead host no longer stretches the every-minute pass",
					"Host keys are pinned on first use, so a swapped host fails instead of being trusted",
				],
			},
			{ type: "h2", text: "Docker control center" },
			{
				type: "p",
				text: "Admin-gated UI for containers, images, Swarm services/nodes, networks, volumes and system df/prune — operate the daemon without leaving the panel. Cluster-wide procedures additionally require the instance admin, because every remote joins the primary Swarm.",
			},
			{
				type: "ul",
				items: [
					"Volume prune and remove never touch volumes owned by services; those rows are returned as protected",
					"Volumes → Browse opens a file browser for one volume, run through a throwaway container with the volume and nothing else (no network, read-only for reads). Paths are confined twice, including a realpath check that catches a symlink inside the volume. Writes, deletes and folder creation are audited",
					"Settings → Servers → the terminal icon opens a shell on a managed host over SSH, instance admin plus servers.manage, audited before the connection is attempted, closing after 30 minutes of inactivity",
					"There is deliberately no terminal into the Nixploy host itself — that would be a shell over every tenant at once",
				],
			},
			{ type: "h2", text: "Platform" },
			{
				type: "ul",
				items: [
					"Private registries (self-hosted or cloud)",
					"In-app updates from GHCR, with release notes and an optional version pin",
					"Host health thresholds and an opt-in weekly cleanup cron",
				],
			},
		],
	},
	{
		slug: "security",
		title: "Auth & security",
		description: "Organizations, roles, capabilities, 2FA, SSO, audit, and encrypted secrets.",
		blocks: [
			{ type: "h2", text: "Accounts" },
			{
				type: "ul",
				items: [
					"Email/password via better-auth; 12-character minimum for new passwords with a live strength hint",
					"First user via /setup — public /register is disabled afterward, and the installer generates a one-time setup token so a scanner cannot win the race on a fresh host",
					"Invitations are shareable links that disclose only a masked email; the sign-up must carry the invitation id and match that exact address",
					"Optional TOTP 2FA, with an org-wide require-2FA gate that blocks every org-scoped call until the member enrols",
					"Password reset by email, plus a break-glass host command when no mail is configured",
					"Optional OIDC single sign-on (NIXPLOY_OIDC_ISSUER / CLIENT_ID / CLIENT_SECRET, plus an optional default org slug for JIT membership) — Authentik, Keycloak, any OpenID provider",
					"Per-account sign-in lockout on top of the per-IP limit: 10 failures in 15 minutes",
				],
			},
			{ type: "h2", text: "Roles & capabilities" },
			{
				type: "ul",
				items: [
					"Roles: viewer < member < deployer < admin < owner",
					"27 capability overlays (projects, services, secrets, domains, backups, schedules, gitops, AI, infrastructure, organization)",
					"Invite members; set per-member capability grants on top of the role baseline",
					"Rank-bound capabilities (servers, docker, org settings, members) stay admin-only — an overlay cannot delegate them downward",
					"Anything that reaches the shared host or cluster additionally requires the instance admin, whatever the org role: Swarm joins and the manager role, cluster-wide Docker, host-privileged compose, wildcard domains, layer-4 entrypoints, instance backups, self-update, network and container-hardening overrides",
				],
			},
			{ type: "h2", text: "API keys" },
			{
				type: "ul",
				items: [
					"Scoped: read, deploy, write or full access — the effective set is the scope intersected with the owner's own capabilities, never more",
					"Bound to one organization; a bound key refuses every other tenant, including a contradicting header",
					"90-day expiry by default (1 year maximum; Never is instance-admin only), nxp_ prefix so secret scanners catch a leak, and a Last used column",
					"The same scope gates REST, MCP, the Prometheus endpoint and the deploy webhook",
					"Rate limited per key (120 requests/minute); a throttled request answers 429 with Retry-After",
					"Keys created before scopes existed are labelled Legacy — full access. Rotate them",
				],
			},
			{ type: "h2", text: "Audit log" },
			{
				type: "ul",
				items: [
					"Every meaningful mutation appends a row: actor, dot-namespaced action, target, client IP and user agent, and a free-form metadata blob that never holds secrets",
					"Auth events are in the same trail — sign-in, failed sign-in, lockout, 2FA changes, API-key create/delete, impersonation, and instance-admin user management",
					"The IP is resolved through the trusted-proxy policy and a socket-peer check, so a forged X-Forwarded-For never lands in the trail",
					"Monitoring → Audit log filters by action, target and a since/until window, and exports the current filter as CSV with every column",
					"Retention is NIXPLOY_AUDIT_RETENTION_DAYS (default 365, 0 keeps rows forever)",
					"NIXPLOY_AUDIT_FORWARD=1 mirrors every new row to the instance-admin notification channels, batched once a minute — the panel can delete its own table, it cannot delete a Slack message",
				],
			},
			{ type: "h2", text: "Secrets at rest" },
			{
				type: "ul",
				items: [
					"Env vars, database passwords, registry and git credentials, S3 keys and notification configs live in AES-256-GCM columns keyed by ENCRYPTION_KEY",
					"The panel refuses to boot on the placeholder key from the example env file",
					"Secrets are redacted on read for callers without the secrets.read capability",
					"Build variables never travel on argv — a 0600 env file, --env-file, or a BuildKit secret depending on the builder — and every one of those files is deleted when the build ends",
					"Rotating the key is a supported, online operation: see Key rotation",
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
					"The panel and its Postgres sit on a separate overlay no tenant container ever joins, so a compromised container cannot even resolve them",
					"A service joins the shared, Traefik-facing network only while it has a domain",
					"Managed databases publish no host port unless you opt in, and are reached by the panel with docker exec rather than over the network",
					"Compose stacks keep their own per-stack network on top",
					"Cross-environment and cross-organization DNS is gone by design",
				],
			},
			{ type: "h2", text: "Container defaults" },
			{
				type: "ul",
				items: [
					"All Linux capabilities dropped, with seven added back (no NET_RAW, so ping and ICMP monitors do not work inside tenant containers; no SYS_*)",
					"no-new-privileges on every tenant container",
					"Process (1024) and file-descriptor (65536) ceilings",
					"Rotating JSON logs (10 MB × 3) so one service cannot fill the disk",
					"Org quota CPU/memory applied as per-service limits when the service sets none — 1024 shares is one CPU",
					"These keys are written explicitly on every deploy, so a spec that grew privileges from a manual docker service update is reset rather than inherited",
					"Relaxing the baseline, or overriding the Swarm network list, is instance-admin only",
				],
			},
			{ type: "h2", text: "Compose safety" },
			{
				type: "p",
				text: "Compose files are rendered before they are validated, so a variable reference cannot smuggle a value past the checks, and the checks run on both the raw and the rendered file. Privileged mode, host namespaces, the Docker socket, host binds, published ports, dangerous capabilities, foreign log drivers, unbounded tmpfs, global mode and manager-targeting placement are all refused, and the hardening defaults are injected where the file does not set them.",
			},
			{ type: "h2", text: "Outbound requests" },
			{
				type: "p",
				text: "Everything the panel fetches on your behalf — webhooks, SMTP, self-hosted Git, S3, uptime probes, template sources — goes through one guard. Cloud metadata and link-local ranges are never reachable; private LAN targets need an instance-admin toggle. See Outbound requests.",
			},
		],
	},
	{
		slug: "private-egress",
		title: "Outbound requests",
		description: "The egress policy, and the instance-admin toggle that widens it.",
		blocks: [
			{
				type: "p",
				text: "Notification webhooks, SMTP, Gotify/ntfy/Mattermost, self-hosted Gitea and GitLab, S3 destinations, uptime probes, git clone URLs and template sources are all targets a tenant chooses. They all go through one guard, so a tenant cannot point the panel at the cloud metadata endpoint or at another tenant's container and read the answer.",
			},
			{ type: "h2", text: "What is reachable" },
			{
				type: "ul",
				items: [
					"Public addresses — always",
					"Cloud metadata (169.254/16), multicast, reserved, benchmarking, TEST-NET and IPv6 link-local or documentation ranges — never, on any setting",
					"The Swarm overlay as a bare IP literal — never; a service is reached by the name your organization deployed, not by address",
					"nixploy, nixploy-postgres, nixploy-traefik, traefik and postgres by name — never",
					"Other private, LAN or loopback addresses — only with Allow private network targets",
				],
			},
			{ type: "h2", text: "The toggle" },
			{
				type: "p",
				text: "Settings → Platform → Outbound requests → Allow private network targets is instance admin only and off by default. Turning it on lets organization admins — not just you — point notification, SMTP, registry and S3 targets at hosts on the panel machine's LAN, so it is worth the extra click only for a self-hosted MinIO, Gotify, Gitea or SMTP server. Everything in the first four bullets above stays blocked either way.",
			},
			{
				type: "note",
				text: "NIXPLOY_ALLOW_PRIVATE_EGRESS=1 forces it on for installs with no UI access. The guard caches the setting briefly; saving the toggle invalidates that cache, so the next check sees the new value immediately.",
			},
			{ type: "h2", text: "Why DNS rebinding does not help" },
			{
				type: "p",
				text: "The address that passed the check is the address the socket dials, so a zero-TTL name cannot be re-pointed between the check and the connect. Transports that resolve on their own — SMTP, git, the AWS SDK — re-resolve and compare instead, and refuse when the answer moved.",
			},
			{ type: "h2", text: "Two limits outside the guard" },
			{
				type: "ul",
				items: [
					"Uptime probes need the domains.manage capability and are capped per organization (50 by default)",
					"An image whose registry host is private is refused at pull time unless the application's registry row is self-hosted and its host matches — the Docker daemon does that pull from its own network position, which the panel's guard cannot cover",
				],
			},
		],
	},
	{
		slug: "key-rotation",
		title: "Key rotation",
		description: "Replacing ENCRYPTION_KEY without downtime, and without losing a secret.",
		blocks: [
			{
				type: "p",
				text: "ENCRYPTION_KEY is what makes stored env vars, database passwords, registry and git credentials, S3 keys and notification configs readable. Losing it makes them unrecoverable, so it is worth rotating on a schedule and after anyone who had it leaves.",
			},
			{
				type: "p",
				text: "ENCRYPTION_KEYS is the comma-separated form: the first entry encrypts, every entry can decrypt. That overlap is what makes a rotation possible with the panel running.",
			},
			{ type: "h2", text: "The runbook" },
			{
				type: "pre",
				code: `# 1. generate the new key
openssl rand -hex 32

# 2. /etc/nixploy/.env — NEW key first, current key second
ENCRYPTION_KEYS=<new>,<current>

# 3. restart the panel so it reads both
docker service update --force nixploy

# 4. rewrite every secret column with the new key
docker exec nixploy pnpm -F @nixploy/server nixploy:rotate-key

# 5. /etc/nixploy/.env — drop the old key, restart again
ENCRYPTION_KEYS=<new>`,
			},
			{ type: "h2", text: "Flags worth knowing" },
			{
				type: "ul",
				items: [
					"--dry-run — report what would change and write nothing",
					"--batch-size=500 — rows per transaction",
					"--table=notification — one table only",
					"--skip-undecryptable — leave rows no configured key can read, for the case where a key really was lost",
				],
			},
			{
				type: "note",
				text: "The script discovers the columns from the schema, so a new secret column needs no change to it. Each batch is one transaction, and a row that no configured key can authenticate aborts the run and names the table, column and row — a rotation never half-writes.",
			},
			{ type: "h2", text: "Passphrases and formats" },
			{
				type: "p",
				text: "A key may also be a passphrase of 32 characters or more. Those are stretched with scrypt and written with a version prefix; 64-character hex keys are used directly. Both forms stay readable forever, so moving a passphrase install onto a hex key is just another rotation.",
			},
			{ type: "h2", text: "Before you start" },
			{
				type: "ul",
				items: [
					"Take an instance backup first — the rotation rewrites every secret column",
					"Keep the old key until step 5 has completed successfully; a restore from a dump taken before the rotation still needs it",
					"/etc/nixploy/.env is deliberately excluded from instance backups, so store both keys somewhere the backup reader cannot reach",
					"Treat a lost key as a migration, not a config change: without it every credential has to be re-entered by hand",
				],
			},
		],
	},
	{
		slug: "schedules",
		title: "Schedules & notifications",
		description: "Cron jobs, standalone image jobs, and multi-channel alerts.",
		blocks: [
			{ type: "h2", text: "Schedules" },
			{
				type: "p",
				text: "Run shell or deploy jobs on a cron against applications, compose stacks, remote servers, or the Nixploy host. Enable, disable and run-now from the Schedules page; output is written to a run log with mode 0600, because it regularly includes connection strings.",
			},
			{ type: "h2", text: "Two ways to run" },
			{
				type: "ul",
				items: [
					"exec — docker exec into a container that is already running. The service has to be up",
					"image — docker run a throwaway container from an image you name. The service can be stopped, which is what makes this a real standalone job: a nightly report, a migration, a cleanup that has no business keeping a container alive all day",
				],
			},
			{
				type: "p",
				text: "An image job gets the environment's overlay network (so it reaches that environment's database by name), the merged organization → project → environment → service env over a 0600 env file rather than argv, and the same container hardening a deployment gets.",
			},
			{
				type: "note",
				text: "The job runs with sh as its entrypoint — without that override the image's own ENTRYPOINT would receive the command as arguments and silently ignore it. Exit 127 therefore means the image has no /bin/sh: scratch and distroless images cannot host a job. Run once executes the same container with no schedule row behind it, and still writes a run log and a deployment row.",
			},
			{ type: "h2", text: "Cron runs in the process timezone" },
			{
				type: "p",
				text: "Every cron expression — backups, schedules, the update checker, platform alerts — runs in the panel's timezone, which is UTC unless you set TZ. Changing TZ shifts every existing schedule, so decide at install time rather than after schedules exist. Ticks missed while the panel was down are warned about at boot and, with NIXPLOY_CRON_CATCH_UP=1, replayed once.",
			},
			{ type: "h2", text: "Notification channels" },
			{
				type: "ul",
				items: [
					"Slack, Discord, Telegram, email",
					"Gotify, ntfy, Pushover, Mattermost, Lark, Teams",
					"Custom webhooks",
					"Events: deploy success/fail, backups, thresholds, service alerts, uptime flips, Docker cleanup, panel restarts",
				],
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
					'Deployments show "Interrupted" — only the jobs that were actually building are lost: the queue lives in Postgres, so anything still queued is claimed again on the next boot. Redeploy the interrupted services. A split-worker install avoids it entirely, because rolling the panel does not touch the builder.',
					"Refusing to downgrade — migrations are forward-only. Restore the pre-update dump taken before the version you are leaving, then re-run with the downgrade guard disabled.",
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
					"Traefik 404s a running service — a service joins the shared network only while it has a domain. Re-save the domain to reconcile it.",
					"Editing traefik.yml by hand changes nothing until the proxy restarts: Traefik reads its static config once at start. Only the dynamic directory hot-reloads.",
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
					"Compose validation rejects a file that used to work — the deny-list grew (cgroup_parent, unbounded tmpfs, foreign log drivers, global mode, manager placement). The error names the key.",
					'A managed server answers "unreachable over SSH" — the circuit breaker opened after repeated connection failures. The message says when Nixploy retries; Test connection closes it immediately.',
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
					"backup — destinations (S3 or local disk), schedules, run, run history, restore, verify",
					"preview, schedule, server, registry, ssh-key, notification, incident, monitoring",
					"org, updates, audit, project, environment, template, tag, gitops",
				],
			},
			{ type: "h2", text: "Organizations" },
			{
				type: "pre",
				code: `nixploy org list               # real memberships, with the one this key resolves to
nixploy org current
nixploy org use org_abc123     # pin the active profile to another org
nixploy org use --clear        # back to the key's default`,
			},
			{
				type: "p",
				text: "org use checks the target against your real memberships before writing the profile, so a typo fails immediately instead of turning every later command into a permission error.",
			},
			{ type: "h2", text: "Audit" },
			{
				type: "pre",
				code: `nixploy audit list --since 24h
nixploy audit list --since 7d --until 2026-09-10 --action application.deploy
nixploy audit export --since 30d -o audit.csv`,
			},
			{
				type: "p",
				text: "--since and --until take an ISO timestamp or a relative window (30m, 24h, 7d) and are pushed down to the panel as a predicate, so a window wider than --limit no longer silently loses its older half. audit export writes the whole filtered trail as CSV, including the columns the table does not show.",
			},
			{ type: "h2", text: "Built for scripts" },
			{
				type: "ul",
				items: [
					"--json prints the raw API payload; --quiet prints identifiers for xargs",
					"Exit codes: 0 ok · 1 error · 2 usage · 3 not found or forbidden",
					"Destructive verbs require --yes",
					"--profile switches between panels and organizations",
					"A throttled request is exit 1, not 3: the panel answers 429 with Retry-After and the CLI prints how long to wait (120 requests/minute per key)",
					"Every request has a 30 s timeout; following a build polls rather than holding one long connection",
				],
			},
			{
				type: "note",
				text: "Credentials live in ~/.nixploy/config.json (0600). Override with --url / --api-key / --profile, or NIXPLOY_API_URL / NIXPLOY_API_KEY / NIXPLOY_PROFILE. Every command runs with the key's scope intersected with its owner's capabilities — nixploy auth whoami prints the effective set.",
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
					"apply — converge the live stack and redeploy the services that actually changed",
					"syncFromUrl / syncFromGit — pull desired state into the panel",
				],
			},
			{
				type: "p",
				text: "Available in the project GitOps UI and via nixploy gitops … CLI commands.",
			},
			{
				type: "note",
				text: "Apply is deliberately not one big transaction: every service is applied independently, so one item that fails is reported with its reason while the rest of the stack is still written. Items that failed to apply are never redeployed, and databases are skipped for redeploy because they have no build.",
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
				text: "POST /api/mcp on your panel, over streamable HTTP. Authenticate with the same API key as the REST API (x-api-key, or Authorization: Bearer). The transport is stateless, so every request stands alone.",
			},
			{ type: "h2", text: "Read-only tools" },
			{
				type: "ul",
				items: [
					"list_projects, list_services, list_databases, get_database, list_templates",
					"get_service_logs, list_deployments, get_deployment_provenance (commit, author, trigger)",
					"list_rollback_points and list_domains",
					"get_env and get_resolved_env across organization → project → environment → service",
					"list_incidents, list_backups, list_backup_runs, list_previews",
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
				text: "Every tool call runs through the same tRPC routers as the panel, so organization scoping, key scopes and capability checks apply unchanged — an agent can never do more than the key allows. Give one the narrowest scope that does its job: read for an observer, deploy for one that ships. Deleting projects, services or databases is deliberately not exposed, and neither is restoring a backup over live data. 32 tools; full list and client config in docs/mcp.md.",
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
