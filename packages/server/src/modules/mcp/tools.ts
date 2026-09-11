import { z } from "zod";
import type { appRouter } from "../../trpc/root";
import { checkReadiness, getVersionInfo } from "../observability/health";

/**
 * MCP tool registry. Each tool is a thin, compact-JSON wrapper over an
 * existing tRPC procedure — org scoping, capability checks and audit logging
 * all stay inside the routers, so the MCP surface can never bypass them.
 * The route adapter builds one caller per authenticated request and passes it
 * down; these definitions carry no request state and are unit-testable
 * without Next.js.
 *
 * Descriptions are read by an agent deciding whether to call a tool, so every
 * one of them says what changes, what it costs, and which capability the call
 * needs. Destructive tools say so in the first sentence.
 */

type Caller = ReturnType<typeof appRouter.createCaller>;

export interface McpToolDefinition {
	name: string;
	description: string;
	/** Zod object schema; the MCP SDK validates arguments before dispatch. */
	inputSchema: z.ZodObject<z.ZodRawShape>;
	handler: (caller: Caller, input: never) => Promise<unknown>;
}

/** Keep log payloads small enough for an agent context window. */
const MAX_LOG_CHARS = 16_000;

const applicationIdField = z.string().min(1).describe("Application ID");

/** The five database engines, each backed by its own router of the same shape. */
export const DATABASE_ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

const databaseEngineField = z
	.enum(DATABASE_ENGINES)
	.describe("Database engine; the id belongs to that engine's router");

/** `.env` blob → map. Only used to diff and merge; never re-orders what exists. */
export function parseEnvBlob(env: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of env.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf("=");
		if (index > 0) result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
	}
	return result;
}

export function serializeEnvBlob(env: Record<string, string>): string {
	return Object.entries(env)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

/** Key-level diff. Values never leave the server through this path. */
export function diffEnvKeys(
	before: Record<string, string>,
	after: Record<string, string>,
): { added: string[]; changed: string[]; removed: string[] } {
	const added: string[] = [];
	const changed: string[] = [];
	for (const [key, value] of Object.entries(after)) {
		if (!(key in before)) added.push(key);
		else if (before[key] !== value) changed.push(key);
	}
	return {
		added: added.sort(),
		changed: changed.sort(),
		removed: Object.keys(before)
			.filter((key) => !(key in after))
			.sort(),
	};
}

const envScopeSchema = z
	.enum(["organization", "project", "environment", "service"])
	.describe(
		"Inheritance level: organization → project → environment → service (later wins on key clash)",
	);

type EnvScope = z.infer<typeof envScopeSchema>;

interface EnvTarget {
	scope: EnvScope;
	projectId?: string;
	environmentName?: string;
	serviceType?: "application" | "compose" | DatabaseEngine;
	serviceId?: string;
}

/**
 * Does the caller hold `secrets.read`? Env columns are nullable, so a `null`
 * blob means either "nothing set at this scope" or "hidden from you" — the row
 * alone cannot tell them apart. `organization.myCapabilities` settles it.
 */
async function callerCanReadSecrets(caller: Caller): Promise<boolean> {
	try {
		const me = await caller.organization.myCapabilities();
		return me.capabilities.includes("secrets.read");
	} catch {
		return false;
	}
}

/** Read the raw blob of one scope. `null` means redacted (no secrets.read). */
async function readScopeEnv(caller: Caller, input: EnvTarget): Promise<string | null> {
	switch (input.scope) {
		case "organization": {
			const row = await caller.organization.environment();
			return row.env;
		}
		case "project": {
			const projectId = requireProjectId(input);
			const project = await caller.project.one({ projectId });
			return project.env;
		}
		case "environment": {
			const environment = await findEnvironment(caller, input);
			return environment.env;
		}
		default: {
			const { router, idField } = serviceTarget(input);
			const service = (
				caller as unknown as Record<
					string,
					{ one: (args: unknown) => Promise<{ env: string | null }> }
				>
			)[router];
			if (!service) throw new Error(`Unknown serviceType "${router}"`);
			const row = await service.one({ [idField]: input.serviceId });
			return row?.env ?? null;
		}
	}
}

async function writeScopeEnv(caller: Caller, input: EnvTarget, env: string): Promise<void> {
	switch (input.scope) {
		case "organization":
			await caller.organization.saveEnvironment({ env });
			return;
		case "project": {
			const projectId = requireProjectId(input);
			await caller.project.saveEnvironment({ projectId, env });
			return;
		}
		case "environment": {
			const environment = await findEnvironment(caller, input);
			await caller.environment.saveEnvironment({
				environmentId: environment.environmentId,
				env,
			});
			return;
		}
		default: {
			const { router, idField } = serviceTarget(input);
			const service = (
				caller as unknown as Record<
					string,
					{ saveEnvironment: (args: unknown) => Promise<unknown> }
				>
			)[router];
			if (!service) throw new Error(`Unknown serviceType "${router}"`);
			await service.saveEnvironment({ [idField]: input.serviceId, env });
		}
	}
}

function requireProjectId(input: EnvTarget): string {
	if (!input.projectId) {
		throw new Error(`scope "${input.scope}" requires projectId`);
	}
	return input.projectId;
}

function serviceTarget(input: EnvTarget): { router: string; idField: string } {
	if (!input.serviceType || !input.serviceId) {
		throw new Error('scope "service" requires serviceType and serviceId');
	}
	return { router: input.serviceType, idField: `${input.serviceType}Id` };
}

async function findEnvironment(
	caller: Caller,
	input: EnvTarget,
): Promise<{ environmentId: string; env: string | null }> {
	const projectId = requireProjectId(input);
	const rows = await caller.environment.byProject({ projectId });
	const match = input.environmentName
		? rows.find((row) => row.name === input.environmentName)
		: rows[0];
	if (!match) {
		throw new Error(
			`Environment "${input.environmentName ?? "(first)"}" not found in this project`,
		);
	}
	return match;
}

const compactDeployment = (row: {
	deploymentId: string;
	title: string;
	status: string;
	errorMessage: string | null;
	createdAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
}) => ({
	deploymentId: row.deploymentId,
	title: row.title,
	status: row.status,
	errorMessage: row.errorMessage,
	createdAt: row.createdAt,
	startedAt: row.startedAt,
	finishedAt: row.finishedAt,
	durationMs:
		row.startedAt && row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
});

export const mcpTools: McpToolDefinition[] = [
	{
		name: "list_projects",
		description:
			"List every project in the caller's organization, with environments and per-environment service counts.",
		inputSchema: z.object({}),
		handler: async (caller) => {
			const projects = await caller.project.all();
			return projects.map((project) => ({
				projectId: project.projectId,
				name: project.name,
				description: project.description,
				createdAt: project.createdAt,
				environments: project.environments.map((environment) => ({
					environmentId: environment.environmentId,
					name: environment.name,
					services: environment.services,
				})),
			}));
		},
	},
	{
		name: "list_services",
		description:
			"List every service of a project (applications, compose stacks and databases) with status and appName — the appName is what get_service_metrics takes.",
		inputSchema: z.object({
			projectId: z.string().min(1).describe("Project ID (from list_projects)"),
		}),
		handler: async (caller, input: { projectId: string }) => {
			const project = await caller.project.one({ projectId: input.projectId });
			const serviceKinds = [
				["applications", "application", "applicationId"],
				["compose", "compose", "composeId"],
				["postgres", "postgres", "postgresId"],
				["mysql", "mysql", "mysqlId"],
				["mariadb", "mariadb", "mariadbId"],
				["mongo", "mongo", "mongoId"],
				["redis", "redis", "redisId"],
			] as const;
			return project.environments.map((environment) => ({
				environmentId: environment.environmentId,
				environmentName: environment.name,
				services: serviceKinds.flatMap(([kind, type, idField]) =>
					(
						environment.services[kind] as {
							name: string;
							status: string;
							appName: string;
						}[]
					).map((service) => ({
						type,
						id: (service as Record<string, string>)[idField],
						name: service.name,
						status: service.status,
						appName: service.appName,
					})),
				),
			}));
		},
	},
	{
		name: "get_service_logs",
		description:
			"Read the build/deploy log of a service. Pass a deploymentId directly, or an applicationId/composeId to read the latest deployment's log. Capped to the last 16k characters.",
		inputSchema: z
			.object({
				deploymentId: z.string().min(1).optional(),
				applicationId: applicationIdField.optional(),
				composeId: z.string().min(1).optional(),
			})
			.refine((value) => Boolean(value.deploymentId ?? value.applicationId ?? value.composeId), {
				message: "Provide deploymentId, applicationId, or composeId",
			}),
		handler: async (
			caller,
			input: { deploymentId?: string; applicationId?: string; composeId?: string },
		) => {
			const result = await caller.deployment.getLogs(input);
			const truncated = result.log.length > MAX_LOG_CHARS;
			return {
				deploymentId: result.deploymentId,
				status: result.status,
				done: result.done,
				truncated,
				log: truncated ? result.log.slice(-MAX_LOG_CHARS) : result.log,
			};
		},
	},
	{
		name: "list_deployments",
		description:
			"List recent deployments of one service (newest first) with status and duration. Exactly one of applicationId or composeId is required.",
		inputSchema: z
			.object({
				applicationId: applicationIdField.optional(),
				composeId: z.string().min(1).optional(),
				limit: z.number().int().min(1).max(20).optional(),
			})
			.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
				message: "Exactly one of applicationId or composeId is required",
			}),
		handler: async (
			caller,
			input: { applicationId?: string; composeId?: string; limit?: number },
		) => {
			const limit = input.limit ?? 10;
			const page = input.applicationId
				? await caller.deployment.byApplication({ applicationId: input.applicationId, limit })
				: await caller.deployment.byCompose({
						composeId: input.composeId as string,
						limit,
					});
			return {
				deployments: page.deployments.map(compactDeployment),
				nextCursor: page.nextCursor,
			};
		},
	},
	{
		name: "deploy_service",
		description:
			"Queue a fresh build + deploy of an application. Returns the deploymentId to poll with list_deployments / get_service_logs. Requires the service.deploy capability.",
		inputSchema: z.object({
			applicationId: applicationIdField,
			title: z.string().max(255).optional().describe("Optional deployment title"),
		}),
		handler: (caller, input: { applicationId: string; title?: string }) =>
			caller.application.deploy(input),
	},
	{
		name: "stop_service",
		description:
			"Scale an application's swarm service to 0 (config, image and volumes are kept). Requires the service.runtime capability.",
		inputSchema: z.object({ applicationId: applicationIdField }),
		handler: (caller, input: { applicationId: string }) => caller.application.stop(input),
	},
	{
		name: "start_service",
		description:
			"Scale a stopped application's swarm service back to its configured replica count. Requires the service.runtime capability.",
		inputSchema: z.object({ applicationId: applicationIdField }),
		handler: (caller, input: { applicationId: string }) => caller.application.start(input),
	},
	{
		name: "restart_service",
		description:
			"Force-restart every task of an application's swarm service without rebuilding. Requires the service.runtime capability.",
		inputSchema: z.object({ applicationId: applicationIdField }),
		handler: async (caller, input: { applicationId: string }) => {
			const updated = await caller.application.reload(input);
			return { applicationId: updated.applicationId, status: updated.status };
		},
	},
	{
		name: "list_domains",
		description:
			"List domains attached to an application, a compose service, or a whole project (exactly one of the three IDs).",
		inputSchema: z
			.object({
				applicationId: applicationIdField.optional(),
				composeId: z.string().min(1).optional(),
				projectId: z.string().min(1).optional(),
			})
			.refine(
				(value) =>
					[value.applicationId, value.composeId, value.projectId].filter(Boolean).length === 1,
				{ message: "Exactly one of applicationId, composeId, or projectId is required" },
			),
		handler: async (
			caller,
			input: { applicationId?: string; composeId?: string; projectId?: string },
		) => {
			const domains = await caller.domain.all(input);
			return domains.map((domain) => ({
				domainId: domain.domainId,
				host: domain.host,
				path: domain.path,
				port: domain.port,
				https: domain.https,
				certificateType: domain.certificateType,
				serviceName: domain.serviceName,
				applicationId: domain.applicationId,
				composeId: domain.composeId,
			}));
		},
	},
	{
		name: "add_domain",
		description:
			"Attach a domain (host/path/port) to an application or compose service and re-sync Traefik routing. Requires the domains.manage capability.",
		inputSchema: z
			.object({
				host: z.string().min(1).max(255).describe("FQDN, e.g. app.example.com"),
				path: z.string().min(1).optional().describe("URL path prefix, defaults to /"),
				port: z.number().int().min(1).max(65535).optional().describe("Container port to route to"),
				https: z.boolean().optional(),
				certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
				serviceName: z
					.string()
					.optional()
					.describe("Compose only: which compose-file service to route to"),
				applicationId: applicationIdField.optional(),
				composeId: z.string().min(1).optional(),
			})
			.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
				message: "Exactly one of applicationId or composeId is required",
			}),
		handler: async (
			caller,
			input: {
				host: string;
				path?: string;
				port?: number;
				https?: boolean;
				certificateType?: "letsencrypt" | "none" | "custom";
				serviceName?: string;
				applicationId?: string;
				composeId?: string;
			},
		) => {
			const domain = await caller.domain.create(input);
			return {
				domainId: domain.domainId,
				host: domain.host,
				path: domain.path,
				port: domain.port,
				https: domain.https,
				certificateType: domain.certificateType,
			};
		},
	},
	{
		name: "remove_domain",
		description:
			"Delete a domain and re-sync the parent service's Traefik routing. Destructive — requires the domains.manage capability.",
		inputSchema: z.object({
			domainId: z.string().min(1).describe("Domain ID (from list_domains)"),
		}),
		handler: (caller, input: { domainId: string }) => caller.domain.delete(input),
	},
	{
		name: "get_service_metrics",
		description:
			"Latest CPU/memory stats per running replica of a service, identified by its appName (from list_services). Works for services on the panel host and on managed remote servers: live replica stats come over SSH for pinned services, and when no replica is running the tool falls back to the last sampled metrics from the fleet view, so a remote service never reports an empty result without explanation.",
		inputSchema: z.object({
			appName: z.string().min(1).describe("Swarm service name (appName from list_services)"),
			serverId: z
				.string()
				.nullish()
				.describe("Optional hint; the service row's own serverId always wins"),
		}),
		handler: async (caller, input: { appName: string; serverId?: string | null }) => {
			const replicas = await caller.monitoring.replicaStats(input);
			if (replicas.length > 0) {
				return { appName: input.appName, source: "live-replicas", replicas };
			}
			// No running task (stopped, crash-looping, or an SSH sample that came
			// back empty): fall back to the sampler, which covers remote nodes.
			const fleet = await caller.monitoring.fleetOverview();
			const row = fleet.find((service) => service.appName === input.appName);
			return {
				appName: input.appName,
				source: row?.metrics ? "sampled" : "none",
				replicas: [],
				status: row?.status ?? null,
				serverId: row?.serverId ?? null,
				kind: row?.kind ?? null,
				latestSample: row?.metrics ?? null,
				note: row
					? "No running replica right now; latestSample is the newest 30s sample kept by the metrics cron (48h retention)."
					: "No service with this appName in the caller's organization.",
			};
		},
	},
	{
		name: "list_templates",
		description: "List the one-click deployable template catalog (read-only).",
		inputSchema: z.object({}),
		handler: (caller) => caller.template.all(),
	},

	// ─────────────────────────────────────────────────────── read: databases
	{
		name: "list_databases",
		description:
			"List every database service of a project across all five engines (postgres, mysql, mariadb, mongo, redis) with status and appName. Read-only; passwords are never returned.",
		inputSchema: z.object({
			projectId: z.string().min(1).describe("Project ID (from list_projects)"),
			environmentName: z.string().min(1).optional().describe("Narrow to one environment"),
		}),
		handler: async (caller, input: { projectId: string; environmentName?: string }) => {
			const perEngine = await Promise.all(
				DATABASE_ENGINES.map(async (engine) => {
					const rows = (await (
						caller as unknown as Record<string, { all: (args: unknown) => Promise<unknown[]> }>
					)[engine]?.all(input)) as Array<Record<string, unknown>> | undefined;
					return (rows ?? []).map((row) => ({
						engine,
						id: row[`${engine}Id`] as string,
						name: row.name as string,
						appName: row.appName as string,
						status: row.status as string,
						dockerImage: row.dockerImage as string,
						externalPort: (row.externalPort as number | null) ?? null,
					}));
				}),
			);
			return perEngine.flat();
		},
	},
	{
		name: "get_database",
		description:
			"Full configuration of one database service plus its live container status. Credentials and the env blob are redacted unless the API key's user holds secrets.read.",
		inputSchema: z.object({
			engine: databaseEngineField,
			databaseId: z.string().min(1).describe("Database service ID (from list_databases)"),
		}),
		handler: async (caller, input: { engine: DatabaseEngine; databaseId: string }) => {
			const router = (
				caller as unknown as Record<
					string,
					{
						one: (args: unknown) => Promise<Record<string, unknown>>;
						getStatus: (args: unknown) => Promise<unknown>;
					}
				>
			)[input.engine];
			if (!router) throw new Error(`Unknown engine "${input.engine}"`);
			const key = { [`${input.engine}Id`]: input.databaseId };
			const [row, status] = await Promise.all([
				router.one(key),
				router.getStatus(key).catch(() => null),
			]);
			return {
				engine: input.engine,
				id: input.databaseId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				dockerImage: row.dockerImage,
				databaseName: row.databaseName ?? null,
				databaseUser: row.databaseUser ?? null,
				externalPort: row.externalPort ?? null,
				serverId: row.serverId ?? null,
				containerStatus: status,
			};
		},
	},

	// ───────────────────────────────────────────────── read: env inheritance
	{
		name: "get_env",
		description:
			"Read environment variables at one inheritance level (organization, project, environment or service). Returns the parsed key/value map; values are redacted to null when the API key's user lacks the secrets.read capability, in which case only the key names are returned.",
		inputSchema: z.object({
			scope: envScopeSchema,
			projectId: z.string().min(1).optional().describe("Required for project/environment scope"),
			environmentName: z
				.string()
				.min(1)
				.optional()
				.describe("Environment scope: defaults to the project's first environment"),
			serviceType: z
				.enum(["application", "compose", ...DATABASE_ENGINES])
				.optional()
				.describe("Service scope: which router owns the id"),
			serviceId: z.string().min(1).optional().describe("Service scope: the service ID"),
		}),
		handler: async (caller, input: EnvTarget) => {
			const blob = await readScopeEnv(caller, input);
			if (blob === null && !(await callerCanReadSecrets(caller))) {
				return {
					scope: input.scope,
					redacted: true,
					keys: [],
					note: 'Values are hidden: this API key\'s user lacks the "secrets.read" capability.',
				};
			}
			// `null` with secrets.read simply means nothing is set at this scope.
			const parsed = parseEnvBlob(blob ?? "");
			return {
				scope: input.scope,
				redacted: false,
				keys: Object.keys(parsed).sort(),
				variables: parsed,
			};
		},
	},
	{
		name: "get_resolved_env",
		description:
			"Preview the merged organization → project → environment → service environment exactly as the deploy engine computes it, with the origin of every key. Requires the secrets.read capability.",
		inputSchema: z.object({
			projectId: z.string().min(1),
			environmentName: z.string().min(1),
		}),
		handler: (caller, input: { projectId: string; environmentName: string }) =>
			caller.project.getResolvedEnvironment(input),
	},

	// ────────────────────────────────────── read: incidents, backups, previews
	{
		name: "list_incidents",
		description:
			"List incidents (alert firings, deploy-failure streaks, watchdog events, uptime flips) newest first, optionally for one project. Read-only.",
		inputSchema: z.object({
			projectId: z.string().min(1).optional().describe("Limit to one project"),
			limit: z.number().int().min(1).max(100).optional().describe("Rows to return (default 20)"),
		}),
		handler: async (caller, input: { projectId?: string; limit?: number }) => {
			const rows = await caller.observability.incidents(input);
			return rows.map((row) => ({
				incidentId: row.incidentId,
				kind: row.kind,
				severity: row.severity,
				title: row.title,
				message: row.message,
				serviceName: row.serviceName,
				createdAt: row.createdAt,
				acknowledgedAt: row.acknowledgedAt,
				resolvedAt: row.resolvedAt,
			}));
		},
	},
	{
		name: "list_backups",
		description:
			"List the backup schedules of one database service, or of the instance itself (databaseType 'web-server'), each with its most recent run. Read-only.",
		inputSchema: z.object({
			databaseType: z
				.enum([...DATABASE_ENGINES, "web-server"])
				.describe("Database engine, or 'web-server' for the instance self-backup"),
			serviceId: z
				.string()
				.min(1)
				.optional()
				.describe("Database service ID; omit only for 'web-server'"),
		}),
		handler: async (
			caller,
			input: { databaseType: DatabaseEngine | "web-server"; serviceId?: string },
		) => {
			const rows =
				input.databaseType === "web-server"
					? await caller.backup.all({ databaseType: "web-server" })
					: await caller.backup.all({
							databaseType: input.databaseType,
							serviceId: input.serviceId as string,
						});
			return rows.map((row) => ({
				backupId: row.backupId,
				database: row.database,
				schedule: row.schedule,
				enabled: row.enabled,
				prefix: row.prefix,
				keepLatestCount: row.keepLatestCount,
				destinationId: row.destinationId,
				lastRun: row.lastRun,
			}));
		},
	},
	{
		name: "list_backup_runs",
		description:
			"Run history of one backup schedule: status, trigger, byte size, stored object key and error, newest first. Read-only — use it to answer 'did last night's backup work?'.",
		inputSchema: z.object({
			backupId: z.string().min(1).describe("Backup schedule ID (from list_backups)"),
			limit: z.number().int().min(1).max(50).optional().describe("Rows to return (default 10)"),
		}),
		handler: (caller, input: { backupId: string; limit?: number }) => caller.backup.runs(input),
	},
	{
		name: "list_previews",
		description:
			"List the pull-request preview deployments of an application with PR metadata, status and expiry. Read-only.",
		inputSchema: z.object({ applicationId: applicationIdField }),
		handler: async (caller, input: { applicationId: string }) => {
			const rows = await caller.previewDeployment.byApplication(input);
			return rows.map((row) => ({
				previewDeploymentId: row.previewDeploymentId,
				pullRequestNumber: row.pullRequestNumber,
				pullRequestTitle: row.pullRequestTitle,
				pullRequestURL: row.pullRequestURL,
				branch: row.branch,
				previewStatus: row.previewStatus,
				appName: row.appName,
				expiresAt: row.expiresAt,
			}));
		},
	},
	{
		name: "get_deployment_provenance",
		description:
			"What produced each recent deployment of a service: commit SHA, commit message and author, what triggered it (manual, api, webhook:<provider>, schedule) and who. Read-only; rows created before the provenance migration report nulls.",
		inputSchema: z
			.object({
				applicationId: applicationIdField.optional(),
				composeId: z.string().min(1).optional(),
				limit: z.number().int().min(1).max(20).optional(),
			})
			.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
				message: "Exactly one of applicationId or composeId is required",
			}),
		handler: async (
			caller,
			input: { applicationId?: string; composeId?: string; limit?: number },
		) => {
			const limit = input.limit ?? 10;
			const page = input.applicationId
				? await caller.deployment.byApplication({ applicationId: input.applicationId, limit })
				: await caller.deployment.byCompose({ composeId: input.composeId as string, limit });
			return page.deployments.map((row) => ({
				deploymentId: row.deploymentId,
				title: row.title,
				status: row.status,
				createdAt: row.createdAt,
				finishedAt: row.finishedAt,
				commitSha: row.commitSha ?? null,
				commitMessage: row.commitMessage ?? null,
				commitAuthor: row.commitAuthor ?? null,
				trigger: row.trigger ?? null,
				triggeredBy: row.triggeredBy ?? null,
			}));
		},
	},
	{
		name: "get_platform_health",
		description:
			"Readiness of the Nixploy instance itself: database, Docker daemon, migrations, deploy queue depth and Traefik, plus the running version. Same report as the unauthenticated GET /api/ready endpoint. Read-only, cached for 5 seconds.",
		inputSchema: z.object({}),
		handler: async () => {
			const [readiness, version] = await Promise.all([
				checkReadiness(),
				Promise.resolve(getVersionInfo()),
			]);
			return { ...readiness, version };
		},
	},

	// ────────────────────────────────────────────────────────── guarded writes
	{
		name: "set_env",
		description:
			"Merge environment variables into one inheritance level and return a key-level diff of what changed. Replace-all at the storage layer: this tool reads the current blob, merges your keys in, and writes it back, so a concurrent edit between read and write is lost. Pass replace:true to drop every existing key instead. Requires the secrets.write capability (plus settings.manage for the organization scope). Values only take effect on the next deploy, redeploy or reload of the affected services.",
		inputSchema: z.object({
			scope: envScopeSchema,
			projectId: z.string().min(1).optional().describe("Required for project/environment scope"),
			environmentName: z.string().min(1).optional(),
			serviceType: z.enum(["application", "compose", ...DATABASE_ENGINES]).optional(),
			serviceId: z.string().min(1).optional(),
			variables: z
				.record(z.string().min(1), z.string())
				.describe("KEY → VALUE pairs to set; existing keys not listed here are kept"),
			replace: z
				.boolean()
				.optional()
				.describe("Replace the whole blob instead of merging (destructive)"),
		}),
		handler: async (
			caller,
			input: EnvTarget & { variables: Record<string, string>; replace?: boolean },
		) => {
			const existing = input.replace ? "" : await readScopeEnv(caller, input);
			if (!input.replace && existing === null && !(await callerCanReadSecrets(caller))) {
				throw new Error(
					'Cannot merge: this API key\'s user lacks "secrets.read", so the current values are hidden. Pass replace:true to overwrite the whole blob instead.',
				);
			}
			const before = parseEnvBlob(existing ?? "");
			const after = { ...before, ...input.variables };
			await writeScopeEnv(caller, input, serializeEnvBlob(after));
			const diff = diffEnvKeys(before, after);
			return {
				scope: input.scope,
				...diff,
				totalKeys: Object.keys(after).length,
				note: "Applied on the next deploy, redeploy or reload of the affected services.",
			};
		},
	},
	{
		name: "list_rollback_points",
		description:
			"List the image pins kept for an application (5 most recent successful builds), newest first. Read-only; feed a rollbackId to rollback_deployment.",
		inputSchema: z.object({ applicationId: applicationIdField }),
		handler: (caller, input: { applicationId: string }) => caller.rollback.all(input),
	},
	{
		name: "rollback_deployment",
		description:
			"Redeploy an application from a stored image pin. Changes what is serving traffic immediately; nothing is rebuilt, so a rollback does not undo database migrations or env changes made since that build. Requires the service.deploy capability.",
		inputSchema: z.object({
			applicationId: applicationIdField,
			rollbackId: z.string().min(1).describe("Rollback point ID (from list_rollback_points)"),
		}),
		handler: (caller, input: { applicationId: string; rollbackId: string }) =>
			caller.application.rollback(input),
	},
	{
		name: "cancel_deployment",
		description:
			"Request cancellation of a queued or running deployment. A running build is killed mid-flight, which can leave a partially pulled image; the currently serving version is untouched. Requires the service.deploy capability.",
		inputSchema: z.object({
			deploymentId: z.string().min(1).describe("Deployment ID (from list_deployments)"),
		}),
		handler: (caller, input: { deploymentId: string }) =>
			caller.application.cancelDeployment(input),
	},
	{
		name: "deploy_compose",
		description:
			"Render, validate and deploy a compose stack. Every $VAR is resolved from the merged environment before the safety checks run, then the stack is applied — running containers of that stack are recreated. Returns the deploymentId to poll with get_service_logs. Requires the service.deploy capability.",
		inputSchema: z.object({
			composeId: z.string().min(1).describe("Compose service ID (from list_services)"),
		}),
		handler: (caller, input: { composeId: string }) => caller.compose.deploy(input),
	},
	{
		name: "run_backup",
		description:
			"Run a backup schedule now: dumps the database, uploads it to the destination and applies the retention policy (which deletes the oldest stored dumps beyond keepLatestCount). Does not modify the live database. Requires the backups.manage capability and the instance-admin role.",
		inputSchema: z.object({
			backupId: z.string().min(1).describe("Backup schedule ID (from list_backups)"),
		}),
		handler: (caller, input: { backupId: string }) => caller.backup.runManually(input),
	},
	{
		name: "verify_backup",
		description:
			"Restore a stored dump into a throwaway container and run a liveness query against it, then throw the container away. Never touches the live database. Slow (it pulls an image and restores the full dump) and the verdict is recorded on the backup run. Requires the backups.manage capability and the instance-admin role.",
		inputSchema: z.object({
			backupId: z.string().min(1).describe("Backup schedule ID (from list_backups)"),
			key: z
				.string()
				.min(1)
				.optional()
				.describe("Stored object key to verify; defaults to the newest dump"),
		}),
		handler: (caller, input: { backupId: string; key?: string }) => caller.backup.verify(input),
	},
	{
		name: "acknowledge_incident",
		description:
			"Mark an incident as being worked on. It stays open but stops re-notifying, and records who acknowledged it. Requires the project.write capability.",
		inputSchema: z.object({
			incidentId: z.string().min(1).describe("Incident ID (from list_incidents)"),
		}),
		handler: (caller, input: { incidentId: string }) =>
			caller.observability.acknowledgeIncident(input),
	},
	{
		name: "resolve_incident",
		description:
			"Close an incident with an optional note. Resolving only changes the record — it does not fix the underlying condition, and an alert rule that still breaches raises a new incident after its cooldown. Requires the project.write capability.",
		inputSchema: z.object({
			incidentId: z.string().min(1).describe("Incident ID (from list_incidents)"),
			note: z.string().max(1000).optional().describe("Why it is resolved; stored on the incident"),
		}),
		handler: (caller, input: { incidentId: string; note?: string }) =>
			caller.observability.resolveIncident(input),
	},
];

export const mcpToolByName = new Map(mcpTools.map((tool) => [tool.name, tool]));
