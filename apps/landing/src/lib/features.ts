import { templateCount } from "@/lib/templates";

export type FeatureDetail = {
	name: string;
	description: string;
};

export type FeatureSection = {
	id: string;
	eyebrow: string;
	title: string;
	lede: string;
	docHref?: string;
	imageSrc?: string;
	imageAlt?: string;
	details: FeatureDetail[];
};

export const featureJumpLinks = [
	{ href: "#deploy", label: "Deploy" },
	{ href: "#data", label: "Data" },
	{ href: "#edge", label: "Edge" },
	{ href: "#observe", label: "Observe" },
	{ href: "#team", label: "Team" },
	{ href: "#automate", label: "Automate" },
	{ href: "#infra", label: "Infra" },
	{ href: "#ai", label: "AI" },
] as const;

export const featureHighlights = [
	{ label: "Sources", value: "Git · image · zip" },
	{ label: "Builders", value: "5 builders" },
	{ label: "Databases", value: "Postgres → Redis" },
	{ label: "Templates", value: `${templateCount} one-click` },
	{ label: "API surface", value: "REST · CLI · MCP" },
	{ label: "Edge", value: "Traefik v3 + LE" },
] as const;

export const featureSections: FeatureSection[] = [
	{
		id: "deploy",
		eyebrow: "Deploy & build",
		title: "Ship from Git, an image, or a zip — builders you choose per app.",
		lede: "Nixploy queues builds, streams logs live, and rolls Swarm services so a bad deploy never knocks the healthy revision offline. Preview environments attach to pull requests with a fork approval gate.",
		docHref: "/docs/deploy",
		imageSrc: "/screenshots/05-deployments.png",
		imageAlt: "Deployment history in the Nixploy panel",
		details: [
			{
				name: "Git providers",
				description:
					"GitHub, GitLab, Bitbucket, Gitea, and generic Git — OAuth or tokens, webhooks for push and PR events.",
			},
			{
				name: "Sources",
				description:
					"Clone a repo, pull a Docker image (with registry credentials), or upload a zip. Switch sources without recreating the service.",
			},
			{
				name: "Builders",
				description:
					"Nixpacks, Railpack, Dockerfile, Cloud Native Buildpacks, or static → nginx. BuildKit cache keeps rebuilds fast.",
			},
			{
				name: "Deploy queue",
				description:
					"Cancelable jobs with live websocket logs. Interrupted deploys recover cleanly after panel restarts.",
			},
			{
				name: "PR previews",
				description:
					"Ephemeral apps per pull request with auto domains. Fork PRs wait for an explicit approve/deny gate (collaborator checks across providers).",
			},
			{
				name: "Rollbacks",
				description:
					"One-click rollback to any prior image/revision. Swarm rolling updates keep the previous task set online on failure.",
			},
		],
	},
	{
		id: "data",
		eyebrow: "Data & compose",
		title: "Databases you can restore, stacks you can own.",
		lede: "Five engines with connection strings in the panel, scheduled dumps to S3-compatible storage, volume backups for named volumes, and an instance self-backup that captures the panel database plus Traefik/ACME/SSH config.",
		docHref: "/docs/databases",
		imageSrc: "/screenshots/03-project.png",
		imageAlt: "Project services including databases",
		details: [
			{
				name: "Engines",
				description:
					"PostgreSQL, MySQL, MariaDB, MongoDB, and Redis — each a first-class service type.",
			},
			{
				name: "Database backups",
				description:
					"Cron schedules to destinations (S3, MinIO, R2, …). Run now, download, or restore from the UI.",
			},
			{
				name: "Volume backups",
				description: "Snapshot named volumes used by apps and compose stacks on a schedule.",
			},
			{
				name: "Instance backup",
				description:
					"Back up Nixploy itself — panel Postgres plus config under the Nixploy data dir — so you can rebuild a host.",
			},
			{
				name: "Compose / Swarm",
				description:
					"Paste or generate a compose file, deploy as stack or compose, attach domains, stream logs, and keep the file editable after deploy.",
			},
			{
				name: "Environments",
				description:
					"Projects split into environments with their own variables, domains, and history. Clone services across environments.",
			},
		],
	},
	{
		id: "edge",
		eyebrow: "Edge & TLS",
		title: "Traefik routes every public hostname. Certificates stay boring.",
		lede: "Nixploy writes Traefik dynamic YAML for you. Attach domains per service, pick Let's Encrypt or a custom cert, add redirects and basic-auth — then smoke-test on free *.traefik.me hosts before DNS is ready.",
		docHref: "/docs/domains",
		details: [
			{
				name: "Traefik v3",
				description:
					"File-provider config under the Nixploy config dir — no hand-editing YAML for routine domain work.",
			},
			{
				name: "Certificates",
				description:
					"Let's Encrypt ACME for production domains, plus upload/manage custom certificates.",
			},
			{
				name: "Middlewares",
				description: "HTTP→HTTPS redirects, path redirects, and basic-auth security rules per app.",
			},
			{
				name: "traefik.me",
				description:
					"Generate free smoke-test hostnames that resolve to your server without buying DNS.",
			},
			{
				name: "Panel domain",
				description:
					"Point a hostname at the Nixploy UI itself and terminate TLS the same way as apps.",
			},
		],
	},
	{
		id: "observe",
		eyebrow: "Observability",
		title: "Logs, metrics, terminals, alerts — tied to real containers.",
		lede: "Watch build and runtime logs over websockets, sample CPU/memory/network/disk every 30 seconds with 48 hours of history, open a web terminal, and page your team when thresholds or uptime probes fail.",
		docHref: "/docs/observability",
		imageSrc: "/screenshots/06-monitoring.png",
		imageAlt: "Service monitoring charts",
		details: [
			{
				name: "Live logs",
				description: "Build output and container stdout/stderr with follow, search, and download.",
			},
			{
				name: "Metrics history",
				description:
					"Per-service and host samples locally and over SSH for remote Swarm nodes. Fleet overview in one place.",
			},
			{
				name: "Web terminal",
				description: "Exec into running containers from the browser when you need a shell.",
			},
			{
				name: "Alert rules",
				description:
					"Thresholds on CPU, memory, and related signals — routed through notification channels.",
			},
			{
				name: "Uptime & incidents",
				description:
					"HTTP probes, incident timeline, and acknowledgment workflow for on-call clarity.",
			},
		],
	},
	{
		id: "team",
		eyebrow: "Team & security",
		title: "Organizations with real roles — not a shared admin password.",
		lede: "Invite members into owner, admin, deployer, member, or viewer roles, then layer capability overlays for secrets, domains, GitOps, Docker, and AI. Secrets stay encrypted at rest; the audit log records what changed.",
		docHref: "/docs/security",
		details: [
			{
				name: "Roles",
				description:
					"Owner → admin → deployer → member → viewer, enforced on destructive mutations.",
			},
			{
				name: "Capabilities",
				description:
					"Twenty-five overlays to grant or deny slices like secrets, domains, gitops, AI, and docker control.",
			},
			{
				name: "2FA",
				description:
					"TOTP for users, plus org-wide require-2FA so sessions without MFA cannot use the panel.",
			},
			{
				name: "Secrets",
				description:
					"Env vars, DB passwords, registry tokens, and API credentials use encrypted columns.",
			},
			{
				name: "Audit & quotas",
				description:
					"Mutation audit trail, per-org resource quotas, and white-label branding knobs.",
			},
			{
				name: "Notifications",
				description:
					"Slack, Discord, Telegram, email, Gotify, ntfy, Pushover, Mattermost, Lark, Teams, and generic webhooks.",
			},
		],
	},
	{
		id: "automate",
		eyebrow: "Automate",
		title: "Same API for humans, CI, the CLI, and agents.",
		lede: "Every tRPC procedure is also REST at /api/<router>.<procedure>. OpenAPI/Swagger lives on your panel. The CLI and MCP server share that surface so automation stays consistent.",
		docHref: "/api",
		details: [
			{
				name: "REST + Swagger",
				description:
					"x-api-key auth, GET for queries / POST for mutations. Interactive docs at /swagger on your instance.",
			},
			{
				name: "@nixploy/cli",
				description:
					"Login, doctor, projects, apps, compose, templates, gitops — installable as a public npm package.",
			},
			{
				name: "GitOps",
				description:
					"Export, plan, apply, and sync nixploy.yaml so environments stay declarative in git.",
			},
			{
				name: "MCP",
				description:
					"POST /api/mcp with your API key — list projects, deploy, inspect status from Claude, Cursor, and other MCP clients.",
			},
			{
				name: "Schedules",
				description:
					"Cron jobs for app/compose redeploys and host commands — alongside backup schedules.",
			},
		],
	},
	{
		id: "infra",
		eyebrow: "Infrastructure",
		title: "One Swarm today. More servers when you need them.",
		lede: "Start on a single Docker Swarm manager. Add remote nodes over SSH, place services with constraints, manage the daemon from the Docker control center, and update the panel from GHCR without SSH gymnastics.",
		docHref: "/docs/servers",
		imageSrc: "/screenshots/07-docker.png",
		imageAlt: "Docker control center",
		details: [
			{
				name: "Remote servers",
				description:
					"SSH keys in the panel, join the primary Swarm, see capacity and live stats per node.",
			},
			{
				name: "Placement",
				description:
					"Constraints and capacity-aware placement so databases and apps land where you intend.",
			},
			{
				name: "Docker control center",
				description:
					"Containers, images, volumes, networks, Swarm nodes, and prune — without leaving Nixploy.",
			},
			{
				name: "Registries",
				description:
					"Private registry credentials for pulls and pushes used by builds and image sources.",
			},
			{
				name: "Updates & doctor",
				description:
					"In-app GHCR updates for the panel stack, plus doctor checks for Swarm, Traefik, and health.",
			},
		],
	},
	{
		id: "ai",
		eyebrow: "AI & catalog",
		title: "Deploy Copilot when you want help. Templates when you want speed.",
		lede: `Bring your own model key. Copilot explains failed deploys, chats with confirm-gated mutations, and generates compose files. The catalog ships ${templateCount} stacks across 15 categories with CI-checked image tags.`,
		docHref: "/docs/ai",
		imageSrc: "/screenshots/07-templates.png",
		imageAlt: "Template catalog",
		details: [
			{
				name: "Explain failures",
				description:
					"Paste or select a failed deployment and get a grounded explanation of the log tail.",
			},
			{
				name: "Confirm-gated chat",
				description:
					"Copilot can propose actions; destructive steps require explicit confirmation.",
			},
			{
				name: "Generate compose",
				description:
					"Describe a stack in natural language and get an editable compose file in the panel.",
			},
			{
				name: "Template catalog",
				description:
					"Supabase, Plausible, Ghost, Uptime Kuma, Ollama, and dozens more — you own the compose after deploy.",
			},
			{
				name: "CI-checked tags",
				description:
					"Template image references are validated in CI so stale tags get caught before users do.",
			},
		],
	},
];
