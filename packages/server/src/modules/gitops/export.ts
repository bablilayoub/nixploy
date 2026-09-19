import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { type applications, type compose, environments, projects } from "../../db/schema";
import { badRequest, notFound } from "../errors";
import { findProjectById } from "../projects";
import { projectIdFilter } from "../projects/project-scope";
import { type EnvironmentGraph, loadEnvironmentGraph } from "./live";
import {
	envKeysFromDotenv,
	type GitopsApplication,
	type GitopsBasicAuth,
	type GitopsCompose,
	type GitopsDomain,
	type GitopsHooks,
	type GitopsMount,
	type GitopsPort,
	type GitopsPreviews,
	type GitopsRedirect,
	type GitopsSwarm,
	HOOK_COLUMNS,
	NIXPLOY_STACK_VERSION,
	type NixployStack,
	PREVIEW_COLUMNS,
	SWARM_COLUMNS,
	slugifyProjectName,
} from "./schema";

export interface ExportStackOptions {
	/**
	 * Include the secret-bearing fields: inline compose files, hook commands
	 * and file-mount contents. The router only asks for them when the caller
	 * holds `secrets.read` (parity with the `one` redaction). Basic-auth
	 * passwords are never exported — the rows hold bcrypt hashes.
	 */
	includeSensitive?: boolean;
}

/** Drop `undefined` members; a group with nothing set is omitted entirely. */
const compact = <T extends object>(value: T): T | undefined => {
	const entries = Object.entries(value).filter(([, member]) => member !== undefined);
	return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
};

const mapDomains = (
	rows: EnvironmentGraph["domainsByParent"] extends Map<string, infer R> ? R : never,
): GitopsDomain[] =>
	rows.map((domain) => ({
		host: domain.host,
		path: domain.path ?? "/",
		port: domain.port,
		https: domain.https,
		certificateType: domain.certificateType,
		serviceName: domain.serviceName,
		internalPath: domain.internalPath,
		middlewares: domain.middlewares.map((row) => ({
			kind: row.kind,
			config: row.config,
			enabled: row.enabled,
		})),
	}));

const mapMounts = (
	rows: EnvironmentGraph["mountsByParent"] extends Map<string, infer R> ? R : never,
	includeSensitive: boolean,
): GitopsMount[] =>
	rows.map((mount) => ({
		type: mount.type,
		mountPath: mount.mountPath,
		hostPath: mount.type === "bind" ? mount.hostPath : undefined,
		volumeName: mount.type === "volume" ? mount.volumeName : undefined,
		filePath: mount.type === "file" ? mount.filePath : undefined,
		content: mount.type === "file" && includeSensitive ? (mount.content ?? "") : undefined,
		serviceName: mount.serviceName ?? undefined,
	}));

const mapPorts = (
	rows: EnvironmentGraph["portsByParent"] extends Map<string, infer R> ? R : never,
): GitopsPort[] =>
	rows.map((port) => ({
		published: port.publishedPort,
		target: port.targetPort,
		protocol: port.protocol,
		publishMode: port.publishMode,
	}));

const mapRedirects = (
	rows: EnvironmentGraph["redirectsByParent"] extends Map<string, infer R> ? R : never,
): GitopsRedirect[] =>
	rows.map((redirect) => ({
		regex: redirect.regex,
		replacement: redirect.replacement,
		permanent: redirect.permanent,
		serviceName: redirect.serviceName ?? undefined,
	}));

const mapBasicAuth = (
	rows: EnvironmentGraph["securityByParent"] extends Map<string, infer R> ? R : never,
): GitopsBasicAuth[] =>
	rows.map((entry) => ({
		username: entry.username,
		serviceName: entry.serviceName ?? undefined,
	}));

const mapHooks = (
	row: Record<(typeof HOOK_COLUMNS)[keyof typeof HOOK_COLUMNS], string | null>,
	includeSensitive: boolean,
): GitopsHooks | undefined =>
	includeSensitive
		? compact({
				preDeploy: row[HOOK_COLUMNS.preDeploy] ?? undefined,
				postDeploy: row[HOOK_COLUMNS.postDeploy] ?? undefined,
			})
		: undefined;

const mapSwarm = (row: typeof applications.$inferSelect): GitopsSwarm | undefined =>
	compact(
		Object.fromEntries(
			Object.entries(SWARM_COLUMNS).map(([key, column]) => [key, row[column] ?? undefined]),
		) as GitopsSwarm,
	);

const mapPreviews = (
	row: Record<(typeof PREVIEW_COLUMNS)[keyof typeof PREVIEW_COLUMNS], unknown>,
): GitopsPreviews => ({
	enabled: row[PREVIEW_COLUMNS.enabled] as boolean,
	forksRequireApproval: row[PREVIEW_COLUMNS.forksRequireApproval] as boolean,
	limit: row[PREVIEW_COLUMNS.limit] as number,
	ttlHours: (row[PREVIEW_COLUMNS.ttlHours] as number | null) ?? null,
});

const nameOf = (map: Map<string, string>, id: string | null): string | null =>
	id ? (map.get(id) ?? null) : null;

const mapApplication = (
	row: typeof applications.$inferSelect,
	graph: EnvironmentGraph,
	includeSensitive: boolean,
): GitopsApplication => ({
	name: row.name,
	environment: graph.environment.name,
	appName: row.appName,
	description: row.description,
	buildType: row.buildType,
	sourceType: row.sourceType,
	repository: row.repository,
	owner: row.owner,
	branch: row.branch,
	buildPath: row.buildPath,
	gitUrl: row.gitUrl,
	gitBranch: row.gitBranch,
	dockerImage: row.dockerImage,
	dockerfile: row.dockerfile,
	dockerContextPath: row.dockerContextPath,
	dockerBuildStage: row.dockerBuildStage,
	useBuildCache: row.useBuildCache,
	publishDirectory: row.publishDirectory,
	isStaticSpa: row.isStaticSpa,
	replicas: row.replicas,
	command: row.command,
	memoryReservation: row.memoryReservation,
	memoryLimit: row.memoryLimit,
	cpuReservation: row.cpuReservation,
	cpuLimit: row.cpuLimit,
	autoDeploy: row.autoDeploy,
	autoUpdateImage: row.autoUpdateImage,
	watchPaths: row.watchPaths,
	registry: nameOf(graph.registryNameById, row.registryId),
	pushRegistry: nameOf(graph.registryNameById, row.pushRegistryId),
	server: nameOf(graph.serverNameById, row.serverId),
	hooks: mapHooks(row, includeSensitive),
	swarm: mapSwarm(row),
	previews: mapPreviews(row),
	envKeys: envKeysFromDotenv(row.env),
	domains: mapDomains(graph.domainsByParent.get(row.applicationId) ?? []),
	mounts: mapMounts(graph.mountsByParent.get(row.applicationId) ?? [], includeSensitive),
	ports: mapPorts(graph.portsByParent.get(row.applicationId) ?? []),
	redirects: mapRedirects(graph.redirectsByParent.get(row.applicationId) ?? []),
	basicAuth: mapBasicAuth(graph.securityByParent.get(row.applicationId) ?? []),
});

const mapCompose = (
	row: typeof compose.$inferSelect,
	graph: EnvironmentGraph,
	includeSensitive: boolean,
): GitopsCompose => ({
	name: row.name,
	environment: graph.environment.name,
	appName: row.appName,
	description: row.description,
	composeType: row.composeType,
	sourceType: row.sourceType,
	composePath: row.composePath,
	// Inline compose files carry credentials; the router only asks for them
	// when the caller holds `secrets.read` (parity with compose.one redaction).
	composeFile: includeSensitive && row.sourceType === "raw" ? row.composeFile : undefined,
	repository: row.repository,
	owner: row.owner,
	branch: row.branch,
	gitUrl: row.gitUrl,
	gitBranch: row.gitBranch,
	autoDeploy: row.autoDeploy,
	watchPaths: row.watchPaths,
	buildEnabled: row.buildEnabled,
	publishPorts: row.publishPorts,
	isolatedDeployment: row.isolatedDeployment,
	suffix: row.suffix,
	server: nameOf(graph.serverNameById, row.serverId),
	hooks: mapHooks(row, includeSensitive),
	previews: mapPreviews(row),
	envKeys: envKeysFromDotenv(row.env),
	domains: mapDomains(graph.domainsByParent.get(row.composeId) ?? []),
	mounts: mapMounts(graph.mountsByParent.get(row.composeId) ?? [], includeSensitive),
	redirects: mapRedirects(graph.redirectsByParent.get(row.composeId) ?? []),
	basicAuth: mapBasicAuth(graph.securityByParent.get(row.composeId) ?? []),
});

const byName = <T extends { name: string }>(rows: T[]): T[] =>
	[...rows].sort((a, b) => a.name.localeCompare(b.name));

/** Export the current project + environment as a nixploy.yaml-friendly object. */
export const exportStack = async (
	projectId: string,
	environmentName: string,
	organizationId: string,
	options: ExportStackOptions = {},
): Promise<NixployStack> => {
	const includeSensitive = options.includeSensitive === true;
	const graph = await loadEnvironmentGraph(projectId, environmentName, organizationId);
	const { project, environment, services } = graph;

	const database = (row: {
		name: string;
		appName: string;
		description: string | null;
		dockerImage: string;
		externalPort: number | null;
		command: string | null;
		memoryReservation: string | null;
		memoryLimit: string | null;
		cpuReservation: string | null;
		cpuLimit: string | null;
		serverId: string | null;
		env: string | null;
	}) => ({
		name: row.name,
		environment: environment.name,
		appName: row.appName,
		description: row.description,
		dockerImage: row.dockerImage,
		externalPort: row.externalPort,
		command: row.command,
		memoryReservation: row.memoryReservation,
		memoryLimit: row.memoryLimit,
		cpuReservation: row.cpuReservation,
		cpuLimit: row.cpuLimit,
		server: nameOf(graph.serverNameById, row.serverId),
		envKeys: envKeysFromDotenv(row.env),
	});

	return {
		version: NIXPLOY_STACK_VERSION,
		project: {
			name: project.name,
			slug: slugifyProjectName(project.name),
			envKeys: envKeysFromDotenv(project.env),
		},
		environment: {
			name: environment.name,
			description: environment.description,
			envKeys: envKeysFromDotenv(environment.env),
		},
		applications: byName(services.applications).map((row) =>
			mapApplication(row, graph, includeSensitive),
		),
		compose: byName(services.compose).map((row) => mapCompose(row, graph, includeSensitive)),
		databases: {
			postgres: byName(services.postgres).map((row) => ({
				...database(row),
				databaseName: row.databaseName,
				databaseUser: row.databaseUser,
			})),
			mysql: byName(services.mysql).map((row) => ({
				...database(row),
				databaseName: row.databaseName,
				databaseUser: row.databaseUser,
			})),
			mariadb: byName(services.mariadb).map((row) => ({
				...database(row),
				databaseName: row.databaseName,
				databaseUser: row.databaseUser,
			})),
			mongo: byName(services.mongo).map((row) => ({
				...database(row),
				databaseUser: row.databaseUser,
			})),
			redis: byName(services.redis).map((row) => database(row)),
		},
	};
};

/** Resolve a project id from explicit id or stack metadata within an org. */
export const resolveProjectForStack = async (
	organizationId: string,
	stack: NixployStack,
	projectId?: string,
): Promise<typeof projects.$inferSelect> => {
	if (projectId) {
		return findProjectById(projectId, organizationId);
	}
	const slug = stack.project.slug ?? slugifyProjectName(stack.project.name);
	const rows = await db.query.projects.findMany({
		// Resolving a project by slug must not reach one the caller cannot open;
		// the explicit-id path above already goes through `findProjectById`.
		where: and(eq(projects.organizationId, organizationId), projectIdFilter(projects.projectId)),
	});
	const match =
		rows.find((row) => row.name === stack.project.name) ??
		rows.find((row) => slugifyProjectName(row.name) === slug);
	if (!match) {
		throw notFound(
			`Project "${stack.project.name}" not found — pass projectId or create the project first`,
		);
	}
	return match;
};

export const resolveEnvironmentId = async (
	projectId: string,
	stack: NixployStack,
): Promise<{ environmentId: string; environmentName: string }> => {
	const targetName = stack.environment?.name ?? stack.environments?.[0]?.name;
	if (!targetName) {
		throw badRequest("Stack must define environment.name or environments[0].name");
	}
	const environment = await db.query.environments.findFirst({
		where: and(eq(environments.projectId, projectId), eq(environments.name, targetName)),
	});
	if (!environment) {
		throw notFound(`Environment "${targetName}" not found in project`);
	}
	return {
		environmentId: environment.environmentId,
		environmentName: environment.name,
	};
};

export const randomPassword = () => randomBytes(18).toString("base64url");
