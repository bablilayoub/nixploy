import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { type applications, type compose, domains, environments, projects } from "../../db/schema";
import { badRequest, notFound } from "../errors";
import { findProjectById, getEnvironmentServices } from "../projects";
import {
	envKeysFromDotenv,
	type GitopsApplication,
	type GitopsCompose,
	type GitopsDomain,
	NIXPLOY_STACK_VERSION,
	type NixployStack,
	slugifyProjectName,
} from "./schema";

const mapApplicationDomains = (rows: Array<typeof domains.$inferSelect>): GitopsDomain[] =>
	rows.map((domain) => ({
		host: domain.host,
		path: domain.path ?? "/",
		port: domain.port,
		https: domain.https,
		certificateType: domain.certificateType,
		serviceName: domain.serviceName,
	}));

const mapApplication = (
	row: typeof applications.$inferSelect,
	environmentName: string,
	domainRows: Array<typeof domains.$inferSelect>,
): GitopsApplication => ({
	name: row.name,
	environment: environmentName,
	appName: row.appName,
	description: row.description,
	buildType: row.buildType,
	sourceType: row.sourceType,
	repository: row.repository,
	owner: row.owner,
	branch: row.branch,
	buildPath: row.buildPath,
	dockerImage: row.dockerImage,
	replicas: row.replicas,
	command: row.command,
	memoryReservation: row.memoryReservation,
	memoryLimit: row.memoryLimit,
	cpuReservation: row.cpuReservation,
	cpuLimit: row.cpuLimit,
	autoDeploy: row.autoDeploy,
	dockerfile: row.dockerfile,
	envKeys: envKeysFromDotenv(row.env),
	domains: mapApplicationDomains(domainRows),
});

const mapCompose = (
	row: typeof compose.$inferSelect,
	environmentName: string,
	domainRows: Array<typeof domains.$inferSelect>,
	includeComposeFile: boolean,
): GitopsCompose => ({
	name: row.name,
	environment: environmentName,
	appName: row.appName,
	description: row.description,
	composeType: row.composeType,
	sourceType: row.sourceType,
	composePath: row.composePath,
	// Inline compose files carry credentials; the router only asks for them
	// when the caller holds `secrets.read` (parity with compose.one redaction).
	composeFile: includeComposeFile && row.sourceType === "raw" ? row.composeFile : undefined,
	repository: row.repository,
	owner: row.owner,
	branch: row.branch,
	autoDeploy: row.autoDeploy,
	envKeys: envKeysFromDotenv(row.env),
	domains: mapApplicationDomains(domainRows),
});

export interface ExportStackOptions {
	/** Include raw compose files (secret-bearing) — caller must hold `secrets.read`. */
	includeComposeFile?: boolean;
}

/** Export the current project + environment as a nixploy.yaml-friendly object. */
export const exportStack = async (
	projectId: string,
	environmentName: string,
	organizationId: string,
	options: ExportStackOptions = {},
): Promise<NixployStack> => {
	const project = await findProjectById(projectId, organizationId);
	const environment = await db.query.environments.findFirst({
		where: and(
			eq(environments.projectId, project.projectId),
			eq(environments.name, environmentName),
		),
	});
	if (!environment) {
		throw notFound(`Environment "${environmentName}" not found in this project`);
	}

	const services = await getEnvironmentServices(environment.environmentId);
	const [applicationDomains, composeDomains] = await Promise.all([
		Promise.all(
			services.applications.map(async (app) => ({
				applicationId: app.applicationId,
				domains: await db.query.domains.findMany({
					where: eq(domains.applicationId, app.applicationId),
				}),
			})),
		),
		Promise.all(
			services.compose.map(async (row) => ({
				composeId: row.composeId,
				domains: await db.query.domains.findMany({
					where: eq(domains.composeId, row.composeId),
				}),
			})),
		),
	]);

	const domainsByApplication = new Map(
		applicationDomains.map((entry) => [entry.applicationId, entry.domains]),
	);
	const domainsByCompose = new Map(composeDomains.map((entry) => [entry.composeId, entry.domains]));

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
		applications: services.applications
			.map((row) =>
				mapApplication(row, environment.name, domainsByApplication.get(row.applicationId) ?? []),
			)
			.sort((a, b) => a.name.localeCompare(b.name)),
		compose: services.compose
			.map((row) =>
				mapCompose(
					row,
					environment.name,
					domainsByCompose.get(row.composeId) ?? [],
					options.includeComposeFile === true,
				),
			)
			.sort((a, b) => a.name.localeCompare(b.name)),
		databases: {
			postgres: services.postgres
				.map((row) => ({
					name: row.name,
					environment: environment.name,
					appName: row.appName,
					description: row.description,
					dockerImage: row.dockerImage,
					databaseName: row.databaseName,
					databaseUser: row.databaseUser,
					externalPort: row.externalPort,
					command: row.command,
					memoryReservation: row.memoryReservation,
					memoryLimit: row.memoryLimit,
					cpuReservation: row.cpuReservation,
					cpuLimit: row.cpuLimit,
					envKeys: envKeysFromDotenv(row.env),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			mysql: services.mysql
				.map((row) => ({
					name: row.name,
					environment: environment.name,
					appName: row.appName,
					description: row.description,
					dockerImage: row.dockerImage,
					databaseName: row.databaseName,
					databaseUser: row.databaseUser,
					externalPort: row.externalPort,
					command: row.command,
					memoryReservation: row.memoryReservation,
					memoryLimit: row.memoryLimit,
					cpuReservation: row.cpuReservation,
					cpuLimit: row.cpuLimit,
					envKeys: envKeysFromDotenv(row.env),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			mariadb: services.mariadb
				.map((row) => ({
					name: row.name,
					environment: environment.name,
					appName: row.appName,
					description: row.description,
					dockerImage: row.dockerImage,
					databaseName: row.databaseName,
					databaseUser: row.databaseUser,
					externalPort: row.externalPort,
					command: row.command,
					memoryReservation: row.memoryReservation,
					memoryLimit: row.memoryLimit,
					cpuReservation: row.cpuReservation,
					cpuLimit: row.cpuLimit,
					envKeys: envKeysFromDotenv(row.env),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			mongo: services.mongo
				.map((row) => ({
					name: row.name,
					environment: environment.name,
					appName: row.appName,
					description: row.description,
					dockerImage: row.dockerImage,
					databaseUser: row.databaseUser,
					externalPort: row.externalPort,
					command: row.command,
					memoryReservation: row.memoryReservation,
					memoryLimit: row.memoryLimit,
					cpuReservation: row.cpuReservation,
					cpuLimit: row.cpuLimit,
					envKeys: envKeysFromDotenv(row.env),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			redis: services.redis
				.map((row) => ({
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
					envKeys: envKeysFromDotenv(row.env),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
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
		where: eq(projects.organizationId, organizationId),
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
