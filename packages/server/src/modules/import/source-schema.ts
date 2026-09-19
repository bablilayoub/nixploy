import { z } from "zod";

/**
 * What the importer reads from a Dokploy panel over its REST API
 * (`/api/<router>.<procedure>`, `x-api-key`). Every schema is lenient on
 * purpose — `.passthrough()` and optional fields — because the source ships
 * weekly and a column we do not use must never break an import. Only the
 * fields the normaliser maps are named; everything else rides along untyped.
 *
 * Read from the source repository's `packages/server/src/db/schema` and its
 * `project` / `application` / `compose` routers (2026-09-19). Their enums
 * for source type, build type, certificate type, mount type, port protocol
 * and publish mode are the same words Nixploy uses.
 */

const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();
const jsonish = z.unknown().nullable().optional();
const named = <K extends string>(idKey: K) =>
	z
		.object({ [idKey]: z.string(), name: z.string() } as Record<K | "name", z.ZodString>)
		.passthrough();

export const sourceEnvironmentSummarySchema = z
	.object({
		environmentId: z.string(),
		name: z.string(),
		description: text,
		env: text,
		applications: z.array(named("applicationId")).default([]),
		compose: z.array(named("composeId")).default([]),
		postgres: z.array(named("postgresId")).default([]),
		mysql: z.array(named("mysqlId")).default([]),
		mariadb: z.array(named("mariadbId")).default([]),
		mongo: z.array(named("mongoId")).default([]),
		redis: z.array(named("redisId")).default([]),
		libsql: z.array(named("libsqlId")).default([]),
	})
	.passthrough();

export const sourceProjectSummarySchema = z
	.object({
		projectId: z.string(),
		name: z.string(),
		description: text,
		env: text,
		environments: z.array(sourceEnvironmentSummarySchema).default([]),
	})
	.passthrough();

export const sourceProjectListSchema = z.array(sourceProjectSummarySchema);

export const sourceDomainSchema = z
	.object({
		host: z.string(),
		https: flag,
		port: z.number().nullable().optional(),
		path: text,
		serviceName: text,
		domainType: text,
		certificateType: z.string().nullable().optional(),
		customCertResolver: text,
		internalPath: text,
		stripPath: flag,
		previewDeploymentId: text,
	})
	.passthrough();

export const sourceMountSchema = z
	.object({
		type: z.enum(["bind", "volume", "file"]),
		hostPath: text,
		volumeName: text,
		filePath: text,
		content: text,
		mountPath: z.string(),
	})
	.passthrough();

export const sourcePortSchema = z
	.object({
		publishedPort: z.number(),
		targetPort: z.number(),
		protocol: z.enum(["tcp", "udp"]).nullable().optional(),
		publishMode: z.enum(["ingress", "host"]).nullable().optional(),
	})
	.passthrough();

export const sourceRedirectSchema = z
	.object({
		regex: z.string(),
		replacement: z.string(),
		permanent: flag,
	})
	.passthrough();

export const sourceSecuritySchema = z.object({ username: z.string() }).passthrough();

const sourceServerRef = z.object({ name: z.string() }).passthrough().nullable().optional();
const sourceRegistryRef = z
	.object({ registryName: z.string() })
	.passthrough()
	.nullable()
	.optional();

const resources = {
	memoryReservation: text,
	memoryLimit: text,
	cpuReservation: text,
	cpuLimit: text,
	command: text,
};

const swarm = {
	healthCheckSwarm: jsonish,
	restartPolicySwarm: jsonish,
	placementSwarm: jsonish,
	updateConfigSwarm: jsonish,
	rollbackConfigSwarm: jsonish,
	modeSwarm: jsonish,
	labelsSwarm: jsonish,
	networkSwarm: jsonish,
};

export const sourceApplicationSchema = z
	.object({
		applicationId: z.string(),
		name: z.string(),
		appName: z.string(),
		description: text,
		env: text,
		previewEnv: text,
		buildArgs: text,
		watchPaths: z.array(z.string()).nullable().optional(),
		previewLimit: z.number().nullable().optional(),
		isPreviewDeploymentsActive: flag,
		...resources,
		sourceType: z.string().nullable().optional(),
		repository: text,
		owner: text,
		branch: text,
		buildPath: text,
		autoDeploy: flag,
		gitlabRepository: text,
		gitlabOwner: text,
		gitlabBranch: text,
		gitlabBuildPath: text,
		giteaRepository: text,
		giteaOwner: text,
		giteaBranch: text,
		giteaBuildPath: text,
		bitbucketRepository: text,
		bitbucketOwner: text,
		bitbucketBranch: text,
		bitbucketBuildPath: text,
		username: text,
		password: text,
		dockerImage: text,
		registryUrl: text,
		customGitUrl: text,
		customGitBranch: text,
		customGitBuildPath: text,
		enableSubmodules: flag,
		dockerfile: text,
		dockerContextPath: text,
		dockerBuildStage: text,
		dropBuildPath: text,
		...swarm,
		replicas: z.number().nullable().optional(),
		buildType: z.string().nullable().optional(),
		publishDirectory: text,
		isStaticSpa: flag,
		domains: z.array(sourceDomainSchema).default([]),
		mounts: z.array(sourceMountSchema).default([]),
		ports: z.array(sourcePortSchema).default([]),
		redirects: z.array(sourceRedirectSchema).default([]),
		security: z.array(sourceSecuritySchema).default([]),
		server: sourceServerRef,
		registry: sourceRegistryRef,
		buildRegistry: sourceRegistryRef,
	})
	.passthrough();

export const sourceComposeSchema = z
	.object({
		composeId: z.string(),
		name: z.string(),
		appName: z.string(),
		description: text,
		env: text,
		composeFile: text,
		sourceType: z.string().nullable().optional(),
		composeType: z.string().nullable().optional(),
		repository: text,
		owner: text,
		branch: text,
		autoDeploy: flag,
		gitlabRepository: text,
		gitlabOwner: text,
		gitlabBranch: text,
		giteaRepository: text,
		giteaOwner: text,
		giteaBranch: text,
		bitbucketRepository: text,
		bitbucketOwner: text,
		bitbucketBranch: text,
		customGitUrl: text,
		customGitBranch: text,
		enableSubmodules: flag,
		command: text,
		composePath: text,
		suffix: text,
		randomize: flag,
		isolatedDeployment: flag,
		watchPaths: z.array(z.string()).nullable().optional(),
		domains: z.array(sourceDomainSchema).default([]),
		mounts: z.array(sourceMountSchema).default([]),
		server: sourceServerRef,
	})
	.passthrough();

export const sourceDatabaseSchema = z
	.object({
		name: z.string(),
		appName: z.string(),
		description: text,
		databaseName: text,
		databaseUser: text,
		dockerImage: text,
		env: text,
		externalPort: z.number().nullable().optional(),
		replicaSets: flag,
		...resources,
		...swarm,
		server: sourceServerRef,
	})
	.passthrough();

export type SourceProjectSummary = z.infer<typeof sourceProjectSummarySchema>;
export type SourceEnvironmentSummary = z.infer<typeof sourceEnvironmentSummarySchema>;
export type SourceApplication = z.infer<typeof sourceApplicationSchema>;
export type SourceCompose = z.infer<typeof sourceComposeSchema>;
export type SourceDatabase = z.infer<typeof sourceDatabaseSchema>;
export type SourceDomain = z.infer<typeof sourceDomainSchema>;
export type SourceMount = z.infer<typeof sourceMountSchema>;
