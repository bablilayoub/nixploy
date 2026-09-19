import { Command } from "commander";
import { apiGet, apiPost, type QueryInput } from "../client.js";
import { CliError, EXIT_ERROR, usageError } from "../errors.js";
import {
	addOutputOptions,
	printList,
	printRecord,
	printResult,
	printValues,
} from "../utils/output.js";
import {
	DEFAULT_WAIT_TIMEOUT_SECONDS,
	deploymentIdFrom,
	reportOutcome,
	waitForDeployment,
} from "../utils/wait-deployment.js";

/**
 * Allow-list of tRPC procedures exposed as thin CLI verbs.
 *
 * One row here == one command. Adding a procedure to the CLI should never mean
 * writing an action handler: declare the group, the verb, the input mapping
 * and the columns to print, and {@link buildRegistryGroups} generates the
 * commander wiring (including `--json` / `--quiet` and the `--yes` guard on
 * destructive verbs).
 *
 * Commands whose UX needs more than a field mapping — log following, `.env`
 * merging, engine dispatch for `db`, middleware chains — stay hand-written in
 * the sibling modules and are attached to the same groups by
 * `commands/index.ts`.
 *
 * Invariants enforced by `registry.test.ts`:
 *   - every `procedure` exists in the server's appRouter,
 *   - `kind` matches the procedure's tRPC type,
 *   - every procedure has a `procedure-docs.ts` entry (OpenAPI summaries),
 *   - group/verb pairs are unique.
 */

export type RegistryValueType = "string" | "number" | "boolean" | "list";

export interface RegistryOption {
	/** Procedure input field this flag feeds. */
	field: string;
	/** Commander flag spec, e.g. `--project-id <id>`. */
	flag: string;
	description: string;
	required?: boolean;
	type?: RegistryValueType;
	/** Default sent when the flag is omitted (kept out of commander so `--json` stays clean). */
	fallback?: string | number | boolean;
}

export interface RegistryEntry {
	/** Top-level command group (`nixploy <group> <verb>`). */
	group: string;
	verb: string;
	/** `<router>.<procedure>` as exposed at `/api/<router>.<procedure>`. */
	procedure: string;
	kind: "query" | "mutation";
	summary: string;
	/** Single positional argument mapped to an input field. */
	argument?: { field: string; label: string; description: string };
	options?: RegistryOption[];
	/** Constant input fields (discriminators the verb pins). */
	fixed?: Record<string, string | number | boolean>;
	/** Columns printed for list results (first column is the `--quiet` id). */
	columns?: string[];
	/** Render the payload as one key/value record instead of a table. */
	single?: boolean;
	/** Confirmation line for mutations (default: "Done."). */
	message?: string;
	/** Requires `--yes`; deletes data or rolls infrastructure. */
	destructive?: boolean;
	/**
	 * The verb returns `{ deploymentId }`. Adds `--wait` / `--wait-timeout`,
	 * which block until the deployment finishes and exit non-zero if it did
	 * not succeed — so a deploy step in a pipeline actually fails the pipeline.
	 */
	queuesDeployment?: boolean;
	aliases?: string[];
}

/** Group descriptions shown by `nixploy --help`. */
export const GROUP_DESCRIPTIONS: Record<string, string> = {
	app: "Manage applications",
	audit: "Read the organization audit log",
	backup: "Database backups, destinations and runs",
	compose: "Manage compose stack services",
	db: "Manage databases (postgres, mysql, mariadb, mongo, redis)",
	deployment: "Deployment history, logs, cancel and rollback",
	domain: "Traefik domains, HTTPS and middlewares",
	env: "Environment variables at every scope",
	environment: "Project environments",
	incident: "Incidents, alert rules and uptime probes",
	monitoring: "Fleet and per-service metrics",
	notification: "Notification channels",
	org: "Organization profile, settings and capabilities",
	preview: "Pull-request preview deployments",
	project: "Manage projects",
	registry: "Private container registries",
	schedule: "Cron schedules",
	server: "Remote Docker Swarm servers",
	"ssh-key": "SSH keys for git and servers",
	tag: "Organization tags and service assignments",
	template: "Browse and deploy catalog templates",
	updates: "In-app panel updates",
	upstream: "External upstreams: origins outside the Swarm fronted by Traefik",
};

const projectIdOption: RegistryOption = {
	field: "projectId",
	flag: "--project-id <id>",
	description: "Project ID",
	required: true,
};

const envNameOption: RegistryOption = {
	field: "environmentName",
	flag: "--env <name>",
	description: "Environment name (defaults to the project's default environment)",
};

const APPLICATION_COLUMNS = ["applicationId", "name", "appName", "status", "buildType"];
const COMPOSE_COLUMNS = ["composeId", "name", "appName", "status", "composeType"];
const DOMAIN_COLUMNS = ["domainId", "host", "path", "port", "https", "certificateType"];
const UPSTREAM_COLUMNS = ["externalUpstreamId", "name", "appName", "targetUrl", "blockedReason"];

export const commandRegistry: RegistryEntry[] = [
	// ---------------------------------------------------------------- project
	{
		group: "project",
		verb: "list",
		procedure: "project.all",
		kind: "query",
		summary: "List projects in the active organization",
		columns: ["projectId", "name", "description", "createdAt"],
	},
	{
		group: "project",
		verb: "get",
		procedure: "project.one",
		kind: "query",
		summary: "Show one project with its environments and services",
		argument: { field: "projectId", label: "<projectId>", description: "Project ID" },
		single: true,
		columns: ["projectId", "name", "description", "createdAt"],
	},
	{
		group: "project",
		verb: "overview",
		procedure: "project.overview",
		kind: "query",
		summary: "Organization counters: projects, services by status, deployments in the last 24 h",
		single: true,
	},
	{
		group: "project",
		verb: "search",
		procedure: "project.search",
		kind: "query",
		summary: "Search services across the organization by name",
		argument: { field: "query", label: "<query>", description: "Search term" },
		columns: ["type", "id", "name", "projectName", "environmentName"],
	},
	{
		group: "project",
		verb: "create",
		procedure: "project.create",
		kind: "mutation",
		summary: "Create a project (with a default environment)",
		options: [
			{ field: "name", flag: "--name <name>", description: "Project name", required: true },
			{ field: "description", flag: "--description <text>", description: "Project description" },
		],
		single: true,
		columns: ["projectId", "name", "description", "createdAt"],
		message: "Project created.",
	},
	{
		group: "project",
		verb: "update",
		procedure: "project.update",
		kind: "mutation",
		summary: "Rename or re-describe a project",
		argument: { field: "projectId", label: "<projectId>", description: "Project ID" },
		options: [
			{ field: "name", flag: "--name <name>", description: "New name" },
			{ field: "description", flag: "--description <text>", description: "New description" },
		],
		single: true,
		columns: ["projectId", "name", "description"],
		message: "Project updated.",
	},
	{
		group: "project",
		verb: "delete",
		procedure: "project.delete",
		kind: "mutation",
		summary: "Delete a project and every service inside it (cascade)",
		argument: { field: "projectId", label: "<projectId>", description: "Project ID" },
		destructive: true,
		message: "Project deleted.",
	},
	// ------------------------------------------------------------ environment
	{
		group: "environment",
		verb: "list",
		procedure: "environment.byProject",
		kind: "query",
		summary: "List the environments of a project",
		options: [projectIdOption],
		columns: ["environmentId", "name", "description", "createdAt"],
	},
	{
		group: "environment",
		verb: "create",
		procedure: "environment.create",
		kind: "mutation",
		summary: "Create an environment inside a project",
		options: [
			projectIdOption,
			{ field: "name", flag: "--name <name>", description: "Environment name", required: true },
			{ field: "description", flag: "--description <text>", description: "Description" },
		],
		single: true,
		columns: ["environmentId", "name", "description"],
		message: "Environment created.",
	},
	{
		group: "environment",
		verb: "clone",
		procedure: "environment.clone",
		kind: "mutation",
		summary: "Clone an environment including its services",
		argument: { field: "environmentId", label: "<environmentId>", description: "Environment ID" },
		options: [
			{ field: "name", flag: "--name <name>", description: "Name of the clone", required: true },
		],
		single: true,
		columns: ["environmentId", "name", "description"],
		message: "Environment cloned.",
	},
	{
		group: "environment",
		verb: "delete",
		procedure: "environment.delete",
		kind: "mutation",
		summary: "Delete an environment and its services (cascade)",
		argument: { field: "environmentId", label: "<environmentId>", description: "Environment ID" },
		destructive: true,
		message: "Environment deleted.",
	},
	// -------------------------------------------------------------------- app
	{
		group: "app",
		verb: "list",
		procedure: "application.all",
		kind: "query",
		summary: "List applications in a project",
		options: [projectIdOption, envNameOption],
		columns: APPLICATION_COLUMNS,
	},
	{
		group: "app",
		verb: "get",
		procedure: "application.one",
		kind: "query",
		summary: "Show one application (source, build, Swarm settings)",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		single: true,
		columns: [
			"applicationId",
			"name",
			"appName",
			"status",
			"buildType",
			"sourceType",
			"dockerImage",
			"replicas",
		],
	},
	{
		group: "app",
		verb: "create",
		procedure: "application.create",
		kind: "mutation",
		summary: "Create an application",
		options: [
			projectIdOption,
			{ field: "name", flag: "--name <name>", description: "Application name", required: true },
			envNameOption,
			{ field: "description", flag: "--description <text>", description: "Description" },
			{ field: "serverId", flag: "--server-id <id>", description: "Pin to a managed server" },
		],
		single: true,
		columns: ["applicationId", "name", "appName", "status", "environmentId"],
		message: "Application created.",
	},
	{
		group: "app",
		verb: "deploy",
		procedure: "application.deploy",
		queuesDeployment: true,
		kind: "mutation",
		summary: "Queue a fresh build and rollout",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		options: [
			{ field: "title", flag: "--title <title>", description: "Deployment title" },
			{
				field: "ref",
				flag: "--ref <ref>",
				description: "Branch, tag or commit to build instead of the configured branch",
			},
		],
		single: true,
		message: "Deployment queued.",
	},
	{
		group: "app",
		verb: "redeploy-commit",
		procedure: "application.redeployFromDeployment",
		queuesDeployment: true,
		kind: "mutation",
		summary: "Rebuild the commit an earlier deployment built",
		argument: {
			field: "deploymentId",
			label: "<deploymentId>",
			description: "Deployment to rebuild",
		},
		single: true,
		message: "Rebuild queued.",
	},
	{
		group: "app",
		verb: "redeploy",
		procedure: "application.redeploy",
		queuesDeployment: true,
		kind: "mutation",
		summary: "Re-roll the current build without rebuilding the source",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		single: true,
		message: "Redeployment queued.",
	},
	{
		group: "app",
		verb: "start",
		procedure: "application.start",
		kind: "mutation",
		summary: "Scale a stopped application back to its replica count",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		single: true,
		message: "Application started.",
	},
	{
		group: "app",
		verb: "stop",
		procedure: "application.stop",
		kind: "mutation",
		summary: "Scale the Swarm service to 0 (config, image and volumes are kept)",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		single: true,
		message: "Application stopped.",
	},
	{
		group: "app",
		verb: "restart",
		procedure: "application.reload",
		kind: "mutation",
		summary: "Force-restart every task without rebuilding",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		single: true,
		message: "Application restarted.",
	},
	{
		group: "app",
		verb: "delete",
		procedure: "application.delete",
		kind: "mutation",
		summary: "Delete an application, its Swarm service and Traefik routes",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		destructive: true,
		message: "Application deleted.",
	},
	{
		group: "app",
		verb: "move",
		procedure: "application.move",
		kind: "mutation",
		summary: "Move an application to another environment",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		options: [
			{
				field: "environmentId",
				flag: "--environment-id <id>",
				description: "Target environment ID",
				required: true,
			},
		],
		single: true,
		columns: ["applicationId", "name", "appName", "environmentId"],
		message: "Application moved.",
	},
	{
		group: "app",
		verb: "duplicate",
		procedure: "application.duplicate",
		kind: "mutation",
		summary: "Copy an application (config and env) into the same or another environment",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		options: [
			{
				field: "environmentId",
				flag: "--environment-id <id>",
				description: "Target environment ID (defaults to the source environment)",
			},
		],
		single: true,
		columns: ["applicationId", "name", "appName", "environmentId"],
		message: "Application duplicated.",
	},
	{
		group: "app",
		verb: "kill-build",
		procedure: "application.killBuild",
		kind: "mutation",
		summary: "Kill the build currently running for this application",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		message: "Build killed.",
	},
	// ---------------------------------------------------------------- compose
	{
		group: "compose",
		verb: "list",
		procedure: "compose.all",
		kind: "query",
		summary: "List compose services in a project",
		options: [projectIdOption, envNameOption],
		columns: COMPOSE_COLUMNS,
	},
	{
		group: "compose",
		verb: "get",
		procedure: "compose.one",
		kind: "query",
		summary: "Show one compose service",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		single: true,
		columns: ["composeId", "name", "appName", "status", "composeType", "sourceType"],
		aliases: ["one"],
	},
	{
		group: "compose",
		verb: "deploy",
		procedure: "compose.deploy",
		queuesDeployment: true,
		kind: "mutation",
		summary: "Render, validate and deploy the compose stack",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		single: true,
		message: "Compose deployment queued.",
	},
	{
		group: "compose",
		verb: "redeploy",
		procedure: "compose.redeploy",
		queuesDeployment: true,
		kind: "mutation",
		summary: "Redeploy a compose service from its current source",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		single: true,
		message: "Compose redeployment queued.",
	},
	{
		group: "compose",
		verb: "rollback",
		procedure: "compose.rollback",
		queuesDeployment: true,
		destructive: true,
		kind: "mutation",
		summary: "Redeploy the compose file captured by an earlier deployment",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		options: [
			{
				field: "deploymentId",
				flag: "--deployment-id <id>",
				description: "Deployment whose snapshot to restore (see `deployment list`)",
			},
			{ field: "snapshotId", flag: "--snapshot-id <id>", description: "Snapshot ID instead" },
		],
		single: true,
		message: "Compose rollback queued.",
	},
	{
		group: "compose",
		verb: "start",
		procedure: "compose.start",
		kind: "mutation",
		summary: "Start a stopped compose stack",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		message: "Compose stack started.",
	},
	{
		group: "compose",
		verb: "stop",
		procedure: "compose.stop",
		kind: "mutation",
		summary: "Stop every container of a compose stack",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		message: "Compose stack stopped.",
	},
	{
		group: "compose",
		verb: "delete",
		procedure: "compose.delete",
		kind: "mutation",
		summary: "Delete a compose service and tear its stack down",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
		destructive: true,
		message: "Compose service deleted.",
	},
	{
		group: "compose",
		verb: "services",
		procedure: "compose.loadServices",
		kind: "query",
		summary: "List the service names declared in the compose file",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
	},
	{
		group: "compose",
		verb: "containers",
		procedure: "compose.containers",
		kind: "query",
		summary: "List running containers of a compose stack",
		argument: { field: "composeId", label: "<composeId>", description: "Compose ID" },
	},
	// ----------------------------------------------------------------- domain
	{
		group: "domain",
		verb: "list",
		procedure: "domain.all",
		kind: "query",
		summary: "List domains of an application, a compose service, or a whole project",
		options: [
			{ field: "applicationId", flag: "--application-id <id>", description: "Application ID" },
			{ field: "composeId", flag: "--compose-id <id>", description: "Compose ID" },
			{ field: "projectId", flag: "--project-id <id>", description: "Project ID" },
		],
		columns: DOMAIN_COLUMNS,
	},
	{
		group: "domain",
		verb: "get",
		procedure: "domain.one",
		kind: "query",
		summary: "Show one domain",
		argument: { field: "domainId", label: "<domainId>", description: "Domain ID" },
		single: true,
		columns: [...DOMAIN_COLUMNS, "internalPath", "serviceName"],
	},
	{
		group: "domain",
		verb: "remove",
		procedure: "domain.delete",
		kind: "mutation",
		summary: "Delete a domain and re-sync Traefik routing",
		argument: { field: "domainId", label: "<domainId>", description: "Domain ID" },
		destructive: true,
		message: "Domain removed.",
	},
	{
		group: "domain",
		verb: "generate",
		procedure: "domain.generateDomain",
		kind: "query",
		summary: "Generate a free *.traefik.me host for a service",
		options: [{ field: "appName", flag: "--app-name <name>", description: "Service appName" }],
	},
	// --------------------------------------------------------------- upstream
	{
		group: "upstream",
		verb: "list",
		procedure: "upstream.all",
		kind: "query",
		summary: "List the external upstreams of an environment",
		options: [
			{
				field: "environmentId",
				flag: "--environment-id <id>",
				description: "Environment ID",
				required: true,
			},
		],
		columns: UPSTREAM_COLUMNS,
	},
	{
		group: "upstream",
		verb: "get",
		procedure: "upstream.one",
		kind: "query",
		summary: "Show one external upstream",
		argument: { field: "externalUpstreamId", label: "<upstreamId>", description: "Upstream ID" },
		single: true,
		columns: [...UPSTREAM_COLUMNS, "passHostHeader", "insecureSkipVerify", "description"],
	},
	{
		group: "upstream",
		verb: "create",
		procedure: "upstream.create",
		kind: "mutation",
		summary:
			"Front an origin outside the Swarm with Traefik (attach domains with `domain add --upstream-id`)",
		argument: { field: "name", label: "<name>", description: "Display name" },
		options: [
			{
				field: "environmentId",
				flag: "--environment-id <id>",
				description: "Environment ID",
				required: true,
			},
			{
				field: "targetUrl",
				flag: "--url <origin>",
				description: "http(s)://host[:port] — an origin, no path",
				required: true,
			},
			{ field: "description", flag: "--description <text>", description: "Optional description" },
			{
				field: "passHostHeader",
				flag: "--pass-host-header <bool>",
				description: "Forward the public Host header (default true; false sends the target's own)",
				type: "boolean",
			},
			{
				field: "insecureSkipVerify",
				flag: "--insecure-skip-verify",
				description: "Skip TLS verification of a self-signed https target",
				type: "boolean",
			},
		],
		message: "External upstream created.",
	},
	{
		group: "upstream",
		verb: "update",
		procedure: "upstream.update",
		kind: "mutation",
		summary: "Change an external upstream's name, target or host-header mode",
		argument: { field: "externalUpstreamId", label: "<upstreamId>", description: "Upstream ID" },
		options: [
			{ field: "name", flag: "--name <name>", description: "New display name" },
			{ field: "targetUrl", flag: "--url <origin>", description: "New target origin" },
			{ field: "description", flag: "--description <text>", description: "New description" },
			{
				field: "passHostHeader",
				flag: "--pass-host-header <bool>",
				description: "true | false",
				type: "boolean",
			},
			{
				field: "insecureSkipVerify",
				flag: "--insecure-skip-verify <bool>",
				description: "true | false",
				type: "boolean",
			},
		],
		message: "External upstream updated.",
	},
	{
		group: "upstream",
		verb: "resync",
		procedure: "upstream.resync",
		kind: "mutation",
		summary: "Re-check the target now and rewrite the Traefik route",
		argument: { field: "externalUpstreamId", label: "<upstreamId>", description: "Upstream ID" },
		message: "Route re-checked.",
	},
	{
		group: "upstream",
		verb: "remove",
		procedure: "upstream.delete",
		kind: "mutation",
		summary: "Delete an external upstream, its route, domains and probes",
		argument: { field: "externalUpstreamId", label: "<upstreamId>", description: "Upstream ID" },
		destructive: true,
		message: "External upstream removed.",
	},
	// --------------------------------------------------------------- schedule
	{
		group: "schedule",
		verb: "list",
		procedure: "schedule.all",
		kind: "query",
		summary: "List cron schedules (instance admin)",
		columns: ["scheduleId", "name", "cronExpression", "scheduleType", "enabled"],
	},
	{
		group: "schedule",
		verb: "get",
		procedure: "schedule.one",
		kind: "query",
		summary: "Show one schedule",
		argument: { field: "scheduleId", label: "<scheduleId>", description: "Schedule ID" },
		single: true,
	},
	{
		group: "schedule",
		verb: "create",
		procedure: "schedule.create",
		kind: "mutation",
		summary: "Create a cron schedule running a command in a service, a server, or the panel",
		options: [
			{ field: "name", flag: "--name <name>", description: "Schedule name", required: true },
			{
				field: "cronExpression",
				flag: "--cron <expr>",
				description: "Cron expression, e.g. '0 3 * * *'",
				required: true,
			},
			{ field: "command", flag: "--command <cmd>", description: "Command to run", required: true },
			{
				field: "scheduleType",
				flag: "--type <type>",
				description: "application | compose | server | nixploy-server",
				required: true,
			},
			{ field: "applicationId", flag: "--application-id <id>", description: "Target application" },
			{ field: "composeId", flag: "--compose-id <id>", description: "Target compose service" },
			{ field: "serverId", flag: "--server-id <id>", description: "Target managed server" },
			{
				field: "appName",
				flag: "--app-name <name>",
				description: "Container appName to exec into",
			},
			{ field: "shellType", flag: "--shell <shell>", description: "bash | sh" },
		],
		single: true,
		columns: ["scheduleId", "name", "cronExpression", "scheduleType", "enabled"],
		message: "Schedule created.",
	},
	{
		group: "schedule",
		verb: "run",
		procedure: "schedule.runManually",
		kind: "mutation",
		summary: "Run a schedule once, now",
		argument: { field: "scheduleId", label: "<scheduleId>", description: "Schedule ID" },
		message: "Schedule run started.",
	},
	{
		group: "schedule",
		verb: "run-once",
		procedure: "schedule.runOnce",
		kind: "mutation",
		summary: "Run one command in a throwaway container with a service's env, without a schedule",
		options: [
			{
				field: "command",
				flag: "--command <cmd>",
				description: "Command to run",
				required: true,
			},
			{
				field: "image",
				flag: "--image <ref>",
				description: "Image to run it in (the service's own image by default)",
			},
			{ field: "name", flag: "--name <name>", description: "Label for the run" },
			{ field: "applicationId", flag: "--application-id <id>", description: "Target application" },
			{ field: "composeId", flag: "--compose-id <id>", description: "Target compose service" },
			{ field: "shellType", flag: "--shell <shell>", description: "bash | sh" },
		],
		single: true,
		message: "One-off run started.",
	},
	{
		group: "schedule",
		verb: "enable",
		procedure: "schedule.enable",
		kind: "mutation",
		summary: "Enable a schedule",
		argument: { field: "scheduleId", label: "<scheduleId>", description: "Schedule ID" },
		message: "Schedule enabled.",
	},
	{
		group: "schedule",
		verb: "disable",
		procedure: "schedule.disable",
		kind: "mutation",
		summary: "Disable a schedule without deleting it",
		argument: { field: "scheduleId", label: "<scheduleId>", description: "Schedule ID" },
		message: "Schedule disabled.",
	},
	{
		group: "schedule",
		verb: "delete",
		procedure: "schedule.remove",
		kind: "mutation",
		summary: "Delete a schedule",
		argument: { field: "scheduleId", label: "<scheduleId>", description: "Schedule ID" },
		destructive: true,
		message: "Schedule deleted.",
	},
	// ---------------------------------------------------------------- preview
	{
		group: "preview",
		verb: "list",
		procedure: "previewDeployment.byApplication",
		kind: "query",
		summary: "List pull-request previews of an application",
		argument: { field: "applicationId", label: "<applicationId>", description: "Application ID" },
		columns: [
			"previewDeploymentId",
			"pullRequestNumber",
			"branch",
			"previewStatus",
			"appName",
			"expiresAt",
		],
	},
	{
		group: "preview",
		verb: "get",
		procedure: "previewDeployment.one",
		kind: "query",
		summary: "Show one preview deployment",
		argument: {
			field: "previewDeploymentId",
			label: "<previewDeploymentId>",
			description: "Preview deployment ID",
		},
		single: true,
	},
	{
		group: "preview",
		verb: "approve",
		procedure: "previewDeployment.approve",
		kind: "mutation",
		summary: "Approve a fork preview and deploy it",
		argument: {
			field: "previewDeploymentId",
			label: "<previewDeploymentId>",
			description: "Preview deployment ID",
		},
		message: "Preview approved.",
	},
	{
		group: "preview",
		verb: "deny",
		procedure: "previewDeployment.deny",
		kind: "mutation",
		summary: "Deny a fork preview awaiting approval",
		argument: {
			field: "previewDeploymentId",
			label: "<previewDeploymentId>",
			description: "Preview deployment ID",
		},
		message: "Preview denied.",
	},
	{
		group: "preview",
		verb: "delete",
		procedure: "previewDeployment.delete",
		kind: "mutation",
		summary: "Delete a preview deployment and its resources",
		argument: {
			field: "previewDeploymentId",
			label: "<previewDeploymentId>",
			description: "Preview deployment ID",
		},
		destructive: true,
		message: "Preview deleted.",
	},
	// ----------------------------------------------------------------- backup
	{
		group: "backup",
		verb: "list",
		procedure: "backup.all",
		kind: "query",
		summary: "List backup schedules of a database service (or the instance itself)",
		options: [
			{ field: "serviceId", flag: "--service-id <id>", description: "Database service ID" },
			{
				field: "databaseType",
				flag: "--type <type>",
				description: "postgres | mysql | mariadb | mongo | redis | web-server",
				required: true,
			},
		],
		columns: ["backupId", "database", "schedule", "enabled", "prefix", "destinationId"],
	},
	{
		group: "backup",
		verb: "get",
		procedure: "backup.one",
		kind: "query",
		summary: "Show one backup schedule",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		single: true,
	},
	{
		group: "backup",
		verb: "keys",
		procedure: "backup.listBackups",
		kind: "query",
		summary: "List the stored object keys of a backup schedule (newest first)",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
	},
	{
		group: "backup",
		verb: "runs",
		procedure: "backup.runs",
		kind: "query",
		summary: "Run history of a backup schedule with status, size and errors",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		options: [
			{ field: "limit", flag: "--limit <n>", description: "Rows to return", type: "number" },
		],
		columns: ["backupRunId", "status", "trigger", "startedAt", "finishedAt", "bytes", "error"],
	},
	{
		group: "backup",
		verb: "run",
		procedure: "backup.runManually",
		kind: "mutation",
		summary: "Run a backup now (dump + upload + retention sweep)",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		message: "Backup run started.",
	},
	{
		group: "backup",
		verb: "restore",
		procedure: "backup.restore",
		kind: "mutation",
		summary: "Restore a stored dump into the live database (overwrites data)",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		options: [
			{
				field: "key",
				flag: "--key <objectKey>",
				description: "Stored object key (defaults to the newest)",
			},
		],
		destructive: true,
		message: "Restore started.",
	},
	{
		group: "backup",
		verb: "verify",
		procedure: "backup.verify",
		kind: "mutation",
		summary: "Restore a dump into a throwaway container and report whether it is usable",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		options: [
			{
				field: "key",
				flag: "--key <objectKey>",
				description: "Stored object key (defaults to the newest)",
			},
		],
		single: true,
		message: "Verification finished.",
	},
	{
		group: "backup",
		verb: "delete",
		procedure: "backup.remove",
		kind: "mutation",
		summary: "Delete a backup schedule (stored objects are kept)",
		argument: { field: "backupId", label: "<backupId>", description: "Backup ID" },
		destructive: true,
		message: "Backup schedule deleted.",
	},
	// ----------------------------------------------------------------- server
	{
		group: "server",
		verb: "list",
		procedure: "server.all",
		kind: "query",
		summary: "List managed remote servers",
		columns: ["serverId", "name", "ipAddress", "port", "serverStatus"],
	},
	{
		group: "server",
		verb: "get",
		procedure: "server.one",
		kind: "query",
		summary: "Show one managed server",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		single: true,
	},
	{
		group: "server",
		verb: "add",
		procedure: "server.create",
		kind: "mutation",
		summary: "Register a remote server (SSH); run `server setup` afterwards to join the Swarm",
		options: [
			{ field: "name", flag: "--name <name>", description: "Server name", required: true },
			{ field: "ipAddress", flag: "--ip <address>", description: "IP or host", required: true },
			{
				field: "port",
				flag: "--port <port>",
				description: "SSH port (default 22)",
				type: "number",
			},
			{ field: "username", flag: "--username <user>", description: "SSH user (default root)" },
			{ field: "sshKeyId", flag: "--ssh-key-id <id>", description: "SSH key to authenticate with" },
			{ field: "swarmRole", flag: "--role <role>", description: "worker | manager" },
			{ field: "description", flag: "--description <text>", description: "Description" },
		],
		single: true,
		columns: ["serverId", "name", "ipAddress", "port", "serverStatus"],
		message: "Server registered.",
	},
	{
		group: "server",
		verb: "setup",
		procedure: "server.setup",
		kind: "mutation",
		summary: "Install Docker and join the server to the Swarm over SSH",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		message: "Server setup started.",
	},
	{
		group: "server",
		verb: "test",
		procedure: "server.testConnection",
		kind: "mutation",
		summary: "Check SSH reachability and credentials",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		single: true,
		message: "Connection OK.",
	},
	{
		group: "server",
		verb: "stats",
		procedure: "server.getStats",
		kind: "query",
		summary: "Docker, CPU, memory and disk stats of a managed server",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		single: true,
	},
	{
		group: "server",
		verb: "remove",
		procedure: "server.remove",
		kind: "mutation",
		summary: "Remove a server from the fleet (its services stop being managed)",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		destructive: true,
		message: "Server removed.",
	},
	// --------------------------------------------------------------- registry
	{
		group: "registry",
		verb: "list",
		procedure: "registry.all",
		kind: "query",
		summary: "List private container registries",
		columns: ["registryId", "registryName", "registryUrl", "registryType", "imagePrefix"],
	},
	{
		group: "registry",
		verb: "get",
		procedure: "registry.one",
		kind: "query",
		summary: "Show one registry (credentials redacted without secrets.read)",
		argument: { field: "registryId", label: "<registryId>", description: "Registry ID" },
		single: true,
	},
	{
		group: "registry",
		verb: "add",
		procedure: "registry.create",
		kind: "mutation",
		summary: "Add a private registry credential",
		options: [
			{
				field: "registryName",
				flag: "--name <name>",
				description: "Display name",
				required: true,
			},
			{ field: "username", flag: "--username <user>", description: "Username", required: true },
			{
				field: "password",
				flag: "--password <password>",
				description: "Password or token (visible in `ps`; prefer the panel UI)",
				required: true,
			},
			{ field: "registryUrl", flag: "--url <url>", description: "Registry URL" },
			{ field: "registryType", flag: "--type <type>", description: "cloud | selfHosted" },
			{ field: "imagePrefix", flag: "--image-prefix <prefix>", description: "Namespace prefix" },
		],
		single: true,
		columns: ["registryId", "registryName", "registryUrl", "registryType"],
		message: "Registry added.",
	},
	{
		group: "registry",
		verb: "test",
		procedure: "registry.test",
		kind: "mutation",
		summary: "Test a registry login from the panel host or a managed server",
		argument: { field: "registryId", label: "<registryId>", description: "Registry ID" },
		options: [
			{ field: "serverId", flag: "--server-id <id>", description: "Test from this server" },
		],
		message: "Registry login OK.",
	},
	{
		group: "registry",
		verb: "remove",
		procedure: "registry.remove",
		kind: "mutation",
		summary: "Delete a registry credential",
		argument: { field: "registryId", label: "<registryId>", description: "Registry ID" },
		destructive: true,
		message: "Registry removed.",
	},
	// ---------------------------------------------------------------- ssh-key
	{
		group: "ssh-key",
		verb: "list",
		procedure: "sshKey.all",
		kind: "query",
		summary: "List SSH keys",
		columns: ["sshKeyId", "name", "description", "createdAt"],
	},
	{
		group: "ssh-key",
		verb: "get",
		procedure: "sshKey.one",
		kind: "query",
		summary: "Show one SSH key (private key redacted without secrets.read)",
		argument: { field: "sshKeyId", label: "<sshKeyId>", description: "SSH key ID" },
		single: true,
	},
	{
		group: "ssh-key",
		verb: "generate",
		procedure: "sshKey.generate",
		kind: "mutation",
		summary: "Generate an ed25519 key pair inside the panel",
		options: [{ field: "name", flag: "--name <name>", description: "Key name" }],
		single: true,
		columns: ["sshKeyId", "name", "publicKey"],
		message: "SSH key generated.",
	},
	{
		group: "ssh-key",
		verb: "remove",
		procedure: "sshKey.remove",
		kind: "mutation",
		summary: "Delete an SSH key",
		argument: { field: "sshKeyId", label: "<sshKeyId>", description: "SSH key ID" },
		destructive: true,
		message: "SSH key removed.",
	},
	// ----------------------------------------------------------- notification
	{
		group: "notification",
		verb: "list",
		procedure: "notification.all",
		kind: "query",
		summary: "List notification channels",
		columns: ["notificationId", "name", "type", "appDeploy", "appBuildError"],
	},
	{
		group: "notification",
		verb: "get",
		procedure: "notification.one",
		kind: "query",
		summary: "Show one notification channel (secrets redacted without secrets.read)",
		argument: {
			field: "notificationId",
			label: "<notificationId>",
			description: "Notification ID",
		},
		single: true,
	},
	{
		group: "notification",
		verb: "test",
		procedure: "notification.test",
		kind: "mutation",
		summary: "Send a test message through a saved channel",
		argument: {
			field: "notificationId",
			label: "<notificationId>",
			description: "Notification ID",
		},
		message: "Test notification sent.",
	},
	{
		group: "notification",
		verb: "remove",
		procedure: "notification.remove",
		kind: "mutation",
		summary: "Delete a notification channel",
		argument: {
			field: "notificationId",
			label: "<notificationId>",
			description: "Notification ID",
		},
		destructive: true,
		message: "Notification channel removed.",
	},
	// -------------------------------------------------------------- incidents
	{
		group: "incident",
		verb: "list",
		procedure: "observability.incidents",
		kind: "query",
		summary: "List incidents (alert firings and uptime flips), newest first",
		options: [
			{ field: "projectId", flag: "--project-id <id>", description: "Limit to one project" },
			{ field: "limit", flag: "--limit <n>", description: "Rows to return", type: "number" },
		],
		columns: ["incidentId", "kind", "severity", "title", "createdAt", "resolvedAt"],
	},
	{
		group: "incident",
		verb: "alerts",
		procedure: "observability.alertRules",
		kind: "query",
		summary: "List alert rules of a service",
		options: [
			{ field: "applicationId", flag: "--application-id <id>", description: "Application ID" },
			{ field: "composeId", flag: "--compose-id <id>", description: "Compose ID" },
		],
		columns: ["alertRuleId", "metric", "threshold", "enabled", "cooldownMinutes"],
	},
	{
		group: "incident",
		verb: "probes",
		procedure: "observability.uptimeProbes",
		kind: "query",
		summary: "List uptime probes and their last result",
		columns: ["uptimeProbeId", "domainId", "enabled", "status", "lastCheckedAt"],
	},
	{
		group: "incident",
		verb: "logs",
		procedure: "observability.searchLogs",
		kind: "query",
		summary: "Full-text search over persisted service logs",
		argument: { field: "query", label: "<query>", description: "Search term" },
		options: [
			{ field: "serviceId", flag: "--service-id <id>", description: "Limit to one service" },
			{ field: "limit", flag: "--limit <n>", description: "Rows to return", type: "number" },
		],
		columns: ["createdAt", "level", "serviceName", "message"],
	},
	// --------------------------------------------------------------- monitoring
	{
		group: "monitoring",
		verb: "fleet",
		procedure: "monitoring.fleetOverview",
		kind: "query",
		summary: "Every service in the organization with status and its latest metrics sample",
		columns: ["kind", "serviceId", "name", "appName", "status", "projectName", "environmentName"],
	},
	{
		group: "monitoring",
		verb: "service",
		procedure: "monitoring.replicaStats",
		kind: "query",
		summary: "Live CPU/memory per running replica of a service (local or remote node)",
		argument: { field: "appName", label: "<appName>", description: "Swarm service appName" },
		options: [
			{
				field: "serverId",
				flag: "--server-id <id>",
				description: "Managed server the service runs on",
			},
		],
		columns: ["id", "name", "state", "cpu", "memoryUsed", "memoryPercent", "pids"],
	},
	{
		group: "monitoring",
		verb: "history",
		procedure: "monitoring.history",
		kind: "query",
		summary: "Sampled CPU/memory history of a service (up to 48 h)",
		argument: { field: "appName", label: "<appName>", description: "Swarm service appName" },
		options: [
			{
				field: "hours",
				flag: "--hours <n>",
				description: "Window in hours (0.5–48)",
				type: "number",
				fallback: 1,
			},
		],
		columns: ["t", "cpu", "memoryUsed", "memoryTotal"],
	},
	{
		group: "monitoring",
		verb: "server-history",
		procedure: "monitoring.serverHistory",
		kind: "query",
		summary: "Sampled host metrics of a managed server (up to 48 h)",
		argument: { field: "serverId", label: "<serverId>", description: "Server ID" },
		options: [
			{
				field: "hours",
				flag: "--hours <n>",
				description: "Window in hours (0.5–48)",
				type: "number",
				fallback: 1,
			},
		],
		columns: ["t", "cpu", "memoryUsed", "memoryTotal", "diskUsedPercent"],
	},
	// ------------------------------------------------------------------- org
	{
		group: "org",
		verb: "list",
		aliases: ["ls"],
		procedure: "organization.list",
		kind: "query",
		summary: "Organizations this API key's user belongs to (role + active flag)",
		columns: ["organizationId", "name", "slug", "role", "active"],
	},
	{
		group: "org",
		verb: "settings",
		procedure: "organization.settings",
		kind: "query",
		summary: "Organization settings: quotas, branding, 2FA enforcement",
		single: true,
	},
	{
		group: "org",
		verb: "capabilities",
		procedure: "organization.myCapabilities",
		kind: "query",
		summary: "Capabilities the API key's user holds in the active organization",
		single: true,
	},
	{
		group: "org",
		verb: "invite",
		procedure: "organization.inviteMember",
		kind: "mutation",
		summary: "Invite a member by email",
		options: [
			{ field: "email", flag: "--email <email>", description: "Invitee email", required: true },
			{
				field: "role",
				flag: "--role <role>",
				description: "viewer | member | deployer | admin",
				required: true,
			},
			{
				field: "expiryDays",
				flag: "--expiry-days <n>",
				description: "Invitation lifetime in days",
				type: "number",
			},
		],
		single: true,
		message: "Invitation sent.",
	},
	// ---------------------------------------------------------------- updates
	{
		group: "updates",
		verb: "status",
		procedure: "updates.getStatus",
		kind: "query",
		summary: "Current panel version, update settings and the last check result",
		single: true,
	},
	{
		group: "updates",
		verb: "check",
		procedure: "updates.check",
		kind: "mutation",
		summary: "Check GHCR for a newer panel image",
		single: true,
		message: "Update check finished.",
	},
	{
		group: "updates",
		verb: "apply",
		procedure: "updates.runUpdate",
		kind: "mutation",
		summary: "Pull and roll out the panel update (the panel restarts itself)",
		options: [
			{
				field: "force",
				flag: "--force",
				description: "Update even when already on the latest digest",
				type: "boolean",
			},
		],
		destructive: true,
		message: "Update started.",
	},
	// --------------------------------------------------------------- template
	{
		group: "template",
		verb: "list",
		procedure: "template.all",
		kind: "query",
		summary: "List the one-click template catalog",
		columns: ["id", "name", "category", "description"],
	},
	{
		group: "template",
		verb: "get",
		procedure: "template.one",
		kind: "query",
		summary: "Show one template including its compose body and env schema",
		argument: { field: "templateId", label: "<templateId>", description: "Template ID" },
		single: true,
		columns: ["id", "name", "category", "description"],
		aliases: ["one"],
	},
	{
		group: "template",
		verb: "sources",
		procedure: "template.sourcesList",
		kind: "query",
		summary: "List the organization's remote template catalogs",
		columns: ["templateSourceId", "name", "kind", "url", "enabled"],
	},
	{
		group: "template",
		verb: "source-add",
		procedure: "template.sourcesCreate",
		kind: "mutation",
		summary: "Add a remote template catalog (a git repository or an https JSON index)",
		options: [
			{ field: "name", flag: "--name <name>", description: "Catalog name", required: true },
			{
				field: "url",
				flag: "--url <url>",
				description: "Repository URL or https URL of the JSON index",
				required: true,
			},
			{
				field: "kind",
				flag: "--kind <kind>",
				description: "git | http-json",
				fallback: "http-json",
			},
			{ field: "branch", flag: "--branch <name>", description: "Branch (git sources)" },
		],
		single: true,
		columns: ["templateSourceId", "name", "kind", "url", "enabled"],
		message: "Template source added; run `template source-sync` to fetch it.",
	},
	{
		group: "template",
		verb: "source-update",
		procedure: "template.sourcesUpdate",
		kind: "mutation",
		summary: "Change a remote template catalog",
		argument: {
			field: "templateSourceId",
			label: "<templateSourceId>",
			description: "Template source ID",
		},
		options: [
			{ field: "name", flag: "--name <name>", description: "Catalog name" },
			{ field: "url", flag: "--url <url>", description: "Repository URL or JSON index URL" },
			{ field: "kind", flag: "--kind <kind>", description: "git | http-json" },
			{ field: "branch", flag: "--branch <name>", description: "Branch (git sources)" },
			{
				field: "enabled",
				flag: "--enabled <bool>",
				description: "true | false",
				type: "boolean",
			},
		],
		single: true,
		columns: ["templateSourceId", "name", "kind", "url", "enabled"],
		message: "Template source updated.",
	},
	{
		group: "template",
		verb: "source-remove",
		procedure: "template.sourcesDelete",
		kind: "mutation",
		destructive: true,
		summary: "Remove a remote template catalog and the templates it contributed",
		argument: {
			field: "templateSourceId",
			label: "<templateSourceId>",
			description: "Template source ID",
		},
		message: "Template source removed.",
	},
	{
		group: "template",
		verb: "source-sync",
		procedure: "template.sourcesSync",
		kind: "mutation",
		summary: "Fetch a remote template catalog now and report what it contributed",
		argument: {
			field: "templateSourceId",
			label: "<templateSourceId>",
			description: "Template source ID",
		},
		single: true,
		message: "Template source synced.",
	},
	// -------------------------------------------------------------------- tag
	{
		group: "tag",
		verb: "list",
		procedure: "tag.all",
		kind: "query",
		summary: "List organization tags",
		columns: ["tagId", "name", "color"],
	},
	{
		group: "tag",
		verb: "create",
		procedure: "tag.create",
		kind: "mutation",
		summary: "Create a tag",
		options: [
			{ field: "name", flag: "--name <name>", description: "Tag name", required: true },
			{ field: "color", flag: "--color <hex>", description: "Hex color (#RRGGBB)" },
		],
		single: true,
		columns: ["tagId", "name", "color"],
		message: "Tag created.",
	},
	{
		group: "tag",
		verb: "delete",
		procedure: "tag.delete",
		kind: "mutation",
		summary: "Delete a tag and detach it from every service",
		argument: { field: "tagId", label: "<tagId>", description: "Tag ID" },
		destructive: true,
		message: "Tag deleted.",
	},
];

/** Build one commander sub-command from a registry row. */
export function buildRegistryCommand(entry: RegistryEntry): Command {
	const command = new Command(entry.verb).description(entry.summary);
	for (const alias of entry.aliases ?? []) {
		command.alias(alias);
	}
	if (entry.argument) {
		command.argument(entry.argument.label, entry.argument.description);
	}
	for (const option of entry.options ?? []) {
		if (option.required) {
			command.requiredOption(option.flag, option.description);
		} else {
			command.option(option.flag, option.description);
		}
	}
	if (entry.destructive) {
		command.option("-y, --yes", "Confirm the destructive action (required)");
	}
	if (entry.queuesDeployment) {
		command
			.option("--wait", "Block until the deployment finishes; exit non-zero if it failed")
			.option(
				"--wait-timeout <seconds>",
				`Give up waiting after this long (default ${DEFAULT_WAIT_TIMEOUT_SECONDS})`,
			);
	}
	addOutputOptions(command);

	command.action(async (...args: unknown[]) => {
		// commander passes (…arguments, options, command).
		const options = (args[entry.argument ? 1 : 0] ?? {}) as Record<string, unknown>;
		if (entry.destructive && options.yes !== true) {
			throw usageError(
				`\`${entry.group} ${entry.verb}\` is destructive — re-run with --yes to confirm.`,
			);
		}
		const input = buildInput(entry, entry.argument ? (args[0] as string) : undefined, options);
		const payload =
			entry.kind === "query"
				? await apiGet<unknown>(entry.procedure, input as QueryInput)
				: await apiPost<unknown>(entry.procedure, Object.keys(input).length ? input : undefined);

		if (entry.queuesDeployment && options.wait === true) {
			const deploymentId = deploymentIdFrom(payload);
			if (!deploymentId) {
				throw new CliError("The panel queued nothing to wait for", EXIT_ERROR);
			}
			const timeout = options.waitTimeout
				? Number(options.waitTimeout)
				: DEFAULT_WAIT_TIMEOUT_SECONDS;
			if (!Number.isFinite(timeout) || timeout <= 0) {
				throw usageError("--wait-timeout expects a positive number of seconds");
			}
			// `reportOutcome` prints and throws on failure, so it replaces the
			// "queued." confirmation entirely — two verdicts would contradict.
			reportOutcome(await waitForDeployment(deploymentId, timeout));
			return;
		}
		renderPayload(entry, payload);
	});

	return command;
}

/** Map positional + flags onto the procedure's input object. */
export function buildInput(
	entry: RegistryEntry,
	argumentValue: string | undefined,
	options: Record<string, unknown>,
): Record<string, string | number | boolean> {
	const input: Record<string, string | number | boolean> = { ...(entry.fixed ?? {}) };
	if (entry.argument && argumentValue !== undefined) {
		input[entry.argument.field] = argumentValue;
	}
	for (const option of entry.options ?? []) {
		const raw = options[camelCase(option.flag)];
		if (raw === undefined || raw === null) {
			if (option.fallback !== undefined) {
				input[option.field] = option.fallback;
			}
			continue;
		}
		input[option.field] = coerce(option, raw);
	}
	return input;
}

function coerce(option: RegistryOption, raw: unknown): string | number | boolean {
	switch (option.type) {
		case "number": {
			const value = Number(raw);
			if (!Number.isFinite(value)) {
				throw usageError(`${option.flag} expects a number, got "${String(raw)}"`);
			}
			return value;
		}
		case "boolean":
			return raw === true || raw === "true";
		default:
			return String(raw);
	}
}

/**
 * Commander derives the option key from the long flag (`--project-id <id>` →
 * `projectId`). Mirror that so the registry can name fields explicitly.
 */
export function camelCase(flag: string): string {
	const long = flag
		.split(",")
		.map((part) => part.trim())
		.find((part) => part.startsWith("--"));
	const name = (long ?? flag).replace(/^--(no-)?/, "").split(/[ <[]/)[0] ?? "";
	return name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function renderPayload(entry: RegistryEntry, payload: unknown): void {
	if (entry.kind === "mutation" && !entry.single) {
		printResult(payload, entry.message ?? "Done.");
		return;
	}
	if (Array.isArray(payload)) {
		if (payload.length > 0 && payload.every((item) => typeof item !== "object" || item === null)) {
			printValues(payload);
			return;
		}
		printList(payload, entry.columns ?? inferColumns(payload[0]));
		return;
	}
	if (payload === null || typeof payload !== "object") {
		printResult(payload, String(payload ?? entry.message ?? "Done."));
		return;
	}
	printRecord(payload, entry.columns);
}

function inferColumns(sample: unknown): string[] {
	if (!sample || typeof sample !== "object") return ["value"];
	return Object.keys(sample as Record<string, unknown>).slice(0, 6);
}

/** Build every registry group as a commander command, keyed by group name. */
export function buildRegistryGroups(
	entries: RegistryEntry[] = commandRegistry,
): Map<string, Command> {
	const groups = new Map<string, Command>();
	for (const entry of entries) {
		let group = groups.get(entry.group);
		if (!group) {
			group = new Command(entry.group).description(
				GROUP_DESCRIPTIONS[entry.group] ?? `Manage ${entry.group}`,
			);
			groups.set(entry.group, group);
		}
		group.addCommand(buildRegistryCommand(entry));
	}
	return groups;
}
