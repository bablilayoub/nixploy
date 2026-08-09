export type ApiEndpoint = {
	method: "GET" | "POST";
	path: string;
	summary: string;
};

export type ApiRouterGroup = {
	router: string;
	title: string;
	description: string;
	endpoints: ApiEndpoint[];
};

/** Curated REST surface — same paths as panel /swagger. */
export const apiCatalog: ApiRouterGroup[] = [
	{
		router: "project",
		title: "Projects",
		description: "Top-level project CRUD and environment variable inheritance.",
		endpoints: [
			{ method: "GET", path: "project.all", summary: "List projects" },
			{ method: "GET", path: "project.one", summary: "Get one project" },
			{ method: "GET", path: "project.overview", summary: "Dashboard overview" },
			{ method: "GET", path: "project.search", summary: "Search projects/services" },
			{ method: "POST", path: "project.create", summary: "Create project" },
			{ method: "POST", path: "project.update", summary: "Update project" },
			{ method: "POST", path: "project.delete", summary: "Delete project" },
			{ method: "POST", path: "project.saveEnvironment", summary: "Save project env vars" },
		],
	},
	{
		router: "environment",
		title: "Environments",
		description: "Per-project environments (e.g. production / staging).",
		endpoints: [
			{ method: "GET", path: "environment.byProject", summary: "List environments" },
			{ method: "POST", path: "environment.create", summary: "Create environment" },
			{ method: "POST", path: "environment.update", summary: "Rename / update" },
			{ method: "POST", path: "environment.duplicate", summary: "Duplicate environment" },
			{ method: "POST", path: "environment.clone", summary: "Clone services into env" },
			{ method: "POST", path: "environment.delete", summary: "Delete environment" },
		],
	},
	{
		router: "application",
		title: "Applications",
		description: "Git/image apps — deploy, env, source, Swarm options.",
		endpoints: [
			{ method: "GET", path: "application.all", summary: "List applications" },
			{ method: "GET", path: "application.one", summary: "Get application" },
			{ method: "POST", path: "application.create", summary: "Create application" },
			{ method: "POST", path: "application.update", summary: "Update application" },
			{ method: "POST", path: "application.deploy", summary: "Deploy" },
			{ method: "POST", path: "application.redeploy", summary: "Redeploy" },
			{ method: "POST", path: "application.start", summary: "Start" },
			{ method: "POST", path: "application.stop", summary: "Stop" },
			{ method: "POST", path: "application.saveEnvironment", summary: "Save env vars" },
			{ method: "POST", path: "application.saveSource", summary: "Save git/source" },
			{ method: "POST", path: "application.rollback", summary: "Rollback deploy" },
			{ method: "POST", path: "application.delete", summary: "Delete application" },
		],
	},
	{
		router: "compose",
		title: "Compose",
		description: "Docker Compose / Swarm stacks.",
		endpoints: [
			{ method: "GET", path: "compose.all", summary: "List compose services" },
			{ method: "GET", path: "compose.one", summary: "Get compose service" },
			{ method: "POST", path: "compose.create", summary: "Create" },
			{ method: "POST", path: "compose.deploy", summary: "Deploy" },
			{ method: "POST", path: "compose.saveComposeFile", summary: "Save compose YAML" },
			{ method: "POST", path: "compose.saveEnvironment", summary: "Save env vars" },
			{ method: "POST", path: "compose.start", summary: "Start" },
			{ method: "POST", path: "compose.stop", summary: "Stop" },
		],
	},
	{
		router: "template",
		title: "Templates",
		description: "One-click catalog deploy.",
		endpoints: [
			{ method: "GET", path: "template.all", summary: "List templates" },
			{ method: "GET", path: "template.one", summary: "Template details" },
			{ method: "POST", path: "template.deploy", summary: "Deploy template" },
		],
	},
	{
		router: "domain",
		title: "Domains",
		description: "Traefik hosts, TLS, and free smoke domains.",
		endpoints: [
			{ method: "GET", path: "domain.byApplication", summary: "Domains for an app" },
			{ method: "GET", path: "domain.byCompose", summary: "Domains for compose" },
			{ method: "POST", path: "domain.create", summary: "Create domain" },
			{ method: "POST", path: "domain.update", summary: "Update domain" },
			{ method: "POST", path: "domain.delete", summary: "Delete domain" },
			{ method: "GET", path: "domain.generateDomain", summary: "Generate traefik.me host" },
		],
	},
	{
		router: "deployment",
		title: "Deployments",
		description: "History, logs, and stats.",
		endpoints: [
			{ method: "GET", path: "deployment.byApplication", summary: "App deployments" },
			{ method: "GET", path: "deployment.byCompose", summary: "Compose deployments" },
			{ method: "GET", path: "deployment.getLogs", summary: "Deployment log text" },
			{ method: "GET", path: "deployment.recent", summary: "Recent across org" },
		],
	},
	{
		router: "previewDeployment",
		title: "Preview deployments",
		description: "PR previews — create, approve fork gates, delete.",
		endpoints: [
			{ method: "GET", path: "previewDeployment.byApplication", summary: "List previews" },
			{ method: "POST", path: "previewDeployment.create", summary: "Create preview" },
			{ method: "POST", path: "previewDeployment.approve", summary: "Approve fork PR" },
			{ method: "POST", path: "previewDeployment.deny", summary: "Deny fork PR" },
			{ method: "POST", path: "previewDeployment.delete", summary: "Delete preview" },
		],
	},
	{
		router: "postgres / mysql / mariadb / mongo / redis",
		title: "Databases",
		description:
			"Same CRUD pattern per engine: *.all, *.one, *.create, *.update, *.delete, start/stop, saveEnvironment.",
		endpoints: [
			{ method: "GET", path: "postgres.all", summary: "List Postgres (same for mysql, …)" },
			{ method: "POST", path: "postgres.create", summary: "Create database service" },
			{ method: "POST", path: "postgres.deploy", summary: "Deploy / start service" },
		],
	},
	{
		router: "backup / volumeBackup / destination",
		title: "Backups",
		description:
			"DB dumps, volume archives, S3 destinations, instance backup via webServer schedules.",
		endpoints: [
			{ method: "GET", path: "backup.all", summary: "List DB backup schedules" },
			{ method: "POST", path: "backup.runManually", summary: "Run backup now" },
			{ method: "POST", path: "backup.restore", summary: "Restore from key" },
			{ method: "GET", path: "volumeBackup.all", summary: "Volume backup schedules" },
			{ method: "GET", path: "destination.all", summary: "S3 destinations" },
			{ method: "POST", path: "destination.testConnection", summary: "Test destination" },
		],
	},
	{
		router: "gitops",
		title: "GitOps",
		description: "Export / plan / apply nixploy.yaml.",
		endpoints: [
			{ method: "POST", path: "gitops.exportStack", summary: "Export YAML" },
			{ method: "POST", path: "gitops.plan", summary: "Plan changes" },
			{ method: "POST", path: "gitops.runApply", summary: "Apply plan" },
			{ method: "POST", path: "gitops.syncFromUrl", summary: "Sync from HTTPS URL" },
		],
	},
	{
		router: "server / docker / monitoring / observability",
		title: "Infra & observe",
		description: "Remote servers, Docker control center, metrics, alerts.",
		endpoints: [
			{ method: "GET", path: "server.all", summary: "List servers" },
			{ method: "POST", path: "server.setup", summary: "Join Swarm" },
			{ method: "GET", path: "docker.containers", summary: "List containers" },
			{ method: "GET", path: "monitoring.history", summary: "Metrics history" },
			{ method: "GET", path: "observability.incidents", summary: "Incidents" },
			{ method: "POST", path: "observability.upsertAlertRule", summary: "Upsert alert rule" },
		],
	},
	{
		router: "organization / notification / ai / tag / schedule",
		title: "Org & platform",
		description: "Members, capabilities, notifications, Copilot, tags, cron schedules.",
		endpoints: [
			{ method: "GET", path: "organization.settings", summary: "Org settings" },
			{ method: "POST", path: "organization.inviteMember", summary: "Invite member" },
			{ method: "GET", path: "organization.capabilityCatalog", summary: "Capability list" },
			{ method: "GET", path: "notification.all", summary: "Notification channels" },
			{ method: "POST", path: "ai.explainDeployment", summary: "Explain failed deploy" },
			{ method: "POST", path: "ai.generateCompose", summary: "Generate compose YAML" },
			{ method: "GET", path: "schedule.all", summary: "Schedules" },
			{ method: "GET", path: "tag.all", summary: "Tags" },
		],
	},
	{
		router: "github / gitlab / gitea / bitbucket",
		title: "Git providers",
		description: "Connect providers, list repos/branches, webhook secrets.",
		endpoints: [
			{ method: "GET", path: "github.all", summary: "List GitHub apps" },
			{ method: "POST", path: "github.listRepositories", summary: "List repos" },
			{ method: "GET", path: "gitlab.all", summary: "List GitLab providers" },
			{ method: "GET", path: "gitea.all", summary: "List Gitea providers" },
			{ method: "GET", path: "bitbucket.all", summary: "List Bitbucket providers" },
		],
	},
];
