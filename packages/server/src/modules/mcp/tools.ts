import { z } from "zod";
import type { appRouter } from "../../trpc/root";

/**
 * MCP tool registry. Each tool is a thin, compact-JSON wrapper over an
 * existing tRPC procedure — org scoping, capability checks and audit logging
 * all stay inside the routers, so the MCP surface can never bypass them.
 * The route adapter builds one caller per authenticated request and passes it
 * down; these definitions carry no request state and are unit-testable
 * without Next.js.
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
			"Latest CPU/memory stats per running replica of a service, identified by its appName (from list_services). Pass the service's serverId for services pinned to a managed server (sampled over SSH).",
		inputSchema: z.object({
			appName: z.string().min(1).describe("Swarm service name (appName from list_services)"),
			serverId: z.string().nullish(),
		}),
		handler: (caller, input: { appName: string; serverId?: string | null }) =>
			caller.monitoring.replicaStats(input),
	},
	{
		name: "list_templates",
		description: "List the one-click deployable template catalog (read-only).",
		inputSchema: z.object({}),
		handler: (caller) => caller.template.all(),
	},
];

export const mcpToolByName = new Map(mcpTools.map((tool) => [tool.name, tool]));
