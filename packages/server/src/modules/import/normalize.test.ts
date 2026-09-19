import { describe, expect, it } from "vitest";
import { nixployStackSchema } from "../gitops/schema";
import { secretsPayloadSchema } from "../gitops/secrets";
import { normalizeSourceEnvironment } from "./normalize";
import {
	type SourceApplication,
	type SourceCompose,
	type SourceDatabase,
	sourceApplicationSchema,
	sourceComposeSchema,
	sourceDatabaseSchema,
	sourceProjectListSchema,
} from "./source-schema";

/**
 * Fixtures shaped like the source panel's `project.all` and `*.one`
 * answers (its schema as read on 2026-09-19), with the columns this
 * importer does not use included on purpose so `.passthrough()` is proven.
 */

const projectList = sourceProjectListSchema.parse([
	{
		projectId: "prj_1",
		name: "Shop",
		description: "the shop",
		env: "SHARED=1",
		createdAt: "2026-01-01",
		organizationId: "org_1",
		environments: [
			{
				environmentId: "env_1",
				name: "production",
				description: null,
				env: "TIER=prod",
				projectId: "prj_1",
				applications: [{ applicationId: "app_1", name: "api", applicationStatus: "done" }],
				compose: [{ composeId: "cmp_1", name: "monitoring", composeStatus: "idle" }],
				postgres: [{ postgresId: "pg_1", name: "main", applicationStatus: "done" }],
				mysql: [],
				mariadb: [],
				mongo: [],
				redis: [{ redisId: "rd_1", name: "cache", applicationStatus: "done" }],
				libsql: [{ libsqlId: "ls_1", name: "edge", applicationStatus: "idle" }],
			},
		],
	},
]);

const application: SourceApplication = sourceApplicationSchema.parse({
	applicationId: "app_1",
	name: "api",
	appName: "shop-api-3f9a1c",
	description: "the api",
	env: "DATABASE_URL=postgres://shop:secret@main:5432/shop\nSESSION_SECRET=abc",
	previewEnv: "PREVIEW=1",
	buildArgs: "NPM_TOKEN=tok",
	watchPaths: ["src/**"],
	previewLimit: 2,
	isPreviewDeploymentsActive: true,
	previewWildcard: "*.preview.example.com",
	memoryLimit: "512M",
	cpuLimit: "1",
	command: null,
	sourceType: "github",
	repository: "api",
	owner: "acme",
	branch: "main",
	buildPath: "/",
	autoDeploy: true,
	buildType: "dockerfile",
	dockerfile: "Dockerfile",
	dockerContextPath: ".",
	replicas: 2,
	healthCheckSwarm: { Test: ["CMD", "curl", "-f", "http://localhost/health"] },
	labelsSwarm: { team: "shop" },
	rollbackActive: true,
	cleanCache: false,
	railpackVersion: "0.2.2",
	domains: [
		{
			domainId: "dom_1",
			host: "api.example.com",
			https: true,
			port: 3000,
			path: "/",
			certificateType: "letsencrypt",
			internalPath: "/",
			stripPath: false,
			domainType: "application",
		},
		{
			domainId: "dom_2",
			host: "old.example.com",
			https: true,
			port: 3000,
			path: "/legacy",
			certificateType: "custom",
			internalPath: "/v1",
			stripPath: true,
			domainType: "application",
		},
		{
			domainId: "dom_3",
			host: "pr-4.preview.example.com",
			https: true,
			port: 3000,
			path: "/",
			certificateType: "none",
			domainType: "preview",
			previewDeploymentId: "prev_1",
		},
	],
	mounts: [
		{ mountId: "m_1", type: "volume", mountPath: "/data", volumeName: "shop-api-3f9a1c-data" },
		{
			mountId: "m_2",
			type: "file",
			mountPath: "/etc/api/config.yml",
			filePath: "config.yml",
			content: "debug: false",
		},
		{ mountId: "m_3", type: "bind", mountPath: "/srv/x", hostPath: "/srv/x" },
	],
	ports: [
		{ portId: "p_1", publishedPort: 9100, targetPort: 9100, protocol: "tcp", publishMode: "host" },
	],
	redirects: [{ redirectId: "r_1", regex: "^/old", replacement: "/new", permanent: true }],
	security: [{ securityId: "s_1", username: "metrics", password: "$2a$10$hash" }],
	server: { serverId: "srv_1", name: "builder" },
	registry: null,
	buildRegistry: { registryId: "reg_1", registryName: "ghcr" },
});

const stack: SourceCompose = sourceComposeSchema.parse({
	composeId: "cmp_1",
	name: "monitoring",
	appName: "shop-monitoring-9c1d2e",
	description: null,
	env: "GF_SECURITY_ADMIN_PASSWORD=grafana",
	composeFile: "services:\n  grafana:\n    image: grafana/grafana\n",
	sourceType: "raw",
	composeType: "docker-compose",
	command: "docker compose up -d --remove-orphans",
	composePath: "./docker-compose.yml",
	suffix: "",
	randomize: true,
	isolatedDeployment: false,
	domains: [
		{
			domainId: "dom_4",
			host: "grafana.example.com",
			https: true,
			port: 3000,
			path: "/",
			serviceName: "grafana",
			certificateType: "letsencrypt",
			domainType: "compose",
		},
	],
	mounts: [
		{ mountId: "m_4", type: "volume", mountPath: "/var/lib/grafana", volumeName: "grafana" },
	],
	server: null,
});

const postgres: SourceDatabase = sourceDatabaseSchema.parse({
	postgresId: "pg_1",
	name: "main",
	appName: "shop-main-1a2b3c",
	description: null,
	databaseName: "shop",
	databaseUser: "shop",
	databasePassword: "secret",
	dockerImage: "postgres:17",
	command: null,
	env: null,
	memoryLimit: "1G",
	externalPort: null,
	replicas: 1,
	server: { serverId: "srv_2", name: "db-host" },
});

const redis: SourceDatabase = sourceDatabaseSchema.parse({
	redisId: "rd_1",
	name: "cache",
	appName: "shop-cache-4d5e6f",
	description: null,
	databasePassword: "secret",
	dockerImage: "redis:7",
	command: null,
	env: "MAXMEMORY=256mb",
	externalPort: 6379,
});

const sourceProject = projectList[0];
const sourceEnvironment = sourceProject?.environments[0];
if (!sourceProject || !sourceEnvironment) throw new Error("fixture: project list is empty");

const normalize = (overrides: Partial<Parameters<typeof normalizeSourceEnvironment>[0]> = {}) =>
	normalizeSourceEnvironment({
		project: sourceProject,
		environment: sourceEnvironment,
		applications: [application],
		compose: [stack],
		databases: { postgres: [postgres], mysql: [], mariadb: [], mongo: [], redis: [redis] },
		knownServers: new Set(["builder"]),
		knownRegistries: new Set(["ghcr"]),
		...overrides,
	});

describe("normalizeSourceEnvironment", () => {
	it("produces a manifest that parses as version 2 and a secrets payload that parses", () => {
		const { manifest, secrets } = normalize();
		expect(nixployStackSchema.safeParse(manifest).success).toBe(true);
		expect(secretsPayloadSchema.safeParse(secrets).success).toBe(true);
		expect(manifest.version).toBe(2);
		expect(manifest.project.name).toBe("Shop");
		expect(manifest.environment?.name).toBe("production");
	});

	it("keeps env out of the manifest and puts it in the secrets payload", () => {
		const { manifest, secrets } = normalize();
		expect(JSON.stringify(manifest)).not.toContain("secret@main");
		expect(JSON.stringify(manifest)).not.toContain("NPM_TOKEN=tok");
		expect(manifest.applications?.[0]?.envKeys).toEqual(["DATABASE_URL", "SESSION_SECRET"]);
		expect(manifest.project.envKeys).toEqual(["SHARED"]);
		expect(secrets.applications.api).toEqual({
			env: "DATABASE_URL=postgres://shop:secret@main:5432/shop\nSESSION_SECRET=abc",
			buildArgs: "NPM_TOKEN=tok",
			previewEnv: "PREVIEW=1",
		});
		expect(secrets.project.env).toBe("SHARED=1");
		expect(secrets.environment.env).toBe("TIER=prod");
		expect(secrets.databases.redis?.cache?.env).toBe("MAXMEMORY=256mb");
	});

	it("maps an application's source, build, resources, swarm overrides, previews and references", () => {
		const app = normalize().manifest.applications?.[0];
		expect(app).toMatchObject({
			name: "api",
			appName: "shop-api-3f9a1c",
			sourceType: "github",
			repository: "api",
			owner: "acme",
			branch: "main",
			buildType: "dockerfile",
			dockerfile: "Dockerfile",
			dockerContextPath: ".",
			replicas: 2,
			memoryLimit: "512M",
			watchPaths: ["src/**"],
			server: "builder",
			pushRegistry: "ghcr",
			registry: null,
			previews: { enabled: true, limit: 2 },
			swarm: {
				healthCheck: { Test: ["CMD", "curl", "-f", "http://localhost/health"] },
				labels: { team: "shop" },
			},
		});
		expect(app?.ports).toEqual([
			{ published: 9100, target: 9100, protocol: "tcp", publishMode: "host" },
		]);
		expect(app?.redirects).toEqual([{ regex: "^/old", replacement: "/new", permanent: true }]);
	});

	it("drops preview domains, downgrades custom certificates and notes strip-path", () => {
		const { manifest, notes } = normalize();
		const domains = manifest.applications?.[0]?.domains ?? [];
		expect(domains.map((domain) => domain.host)).toEqual(["api.example.com", "old.example.com"]);
		expect(domains[1]).toMatchObject({
			certificateType: "none",
			path: "/legacy",
			internalPath: "/v1",
		});
		expect(notes.some((note) => note.message.includes("custom certificate"))).toBe(true);
		expect(notes.some((note) => note.message.includes("strip path"))).toBe(true);
	});

	it("carries application mounts, skips compose mounts and says so", () => {
		const { manifest, notes, counts } = normalize();
		expect(manifest.applications?.[0]?.mounts).toHaveLength(3);
		expect(manifest.applications?.[0]?.mounts?.[1]).toEqual({
			type: "file",
			mountPath: "/etc/api/config.yml",
			filePath: "config.yml",
			content: "debug: false",
		});
		expect(manifest.compose?.[0]?.mounts).toEqual([]);
		expect(
			notes.find(
				(note) =>
					note.service === "compose/monitoring" && note.message.includes("/var/lib/grafana"),
			),
		).toBeDefined();
		expect(counts.skipped).toBe(2); // the compose mount and the libsql database
	});

	it("never carries basic auth or database passwords, and explains both", () => {
		const { manifest, notes } = normalize();
		expect(manifest.applications?.[0]?.basicAuth).toBeUndefined();
		expect(JSON.stringify(manifest)).not.toContain("$2a$10$hash");
		expect(notes.some((note) => note.message.includes("basic auth for metrics"))).toBe(true);
		expect(
			notes
				.filter((note) => note.message.includes("gets a new password here"))
				.map((note) => note.service),
		).toEqual(["postgres/main", "redis/cache"]);
	});

	it("maps a raw compose stack with its file, isolation and container-scoped domain", () => {
		const { manifest, notes } = normalize();
		expect(manifest.compose?.[0]).toMatchObject({
			name: "monitoring",
			sourceType: "raw",
			composeType: "docker-compose",
			composeFile: "services:\n  grafana:\n    image: grafana/grafana\n",
			isolatedDeployment: true,
			domains: [{ host: "grafana.example.com", serviceName: "grafana", https: true }],
		});
		expect(notes.some((note) => note.message.includes("custom compose command"))).toBe(true);
	});

	it("maps databases with their engine-specific columns and by-name servers", () => {
		const { manifest, notes } = normalize();
		expect(manifest.databases?.postgres?.[0]).toMatchObject({
			name: "main",
			appName: "shop-main-1a2b3c",
			dockerImage: "postgres:17",
			databaseName: "shop",
			databaseUser: "shop",
			memoryLimit: "1G",
			server: null,
		});
		expect(manifest.databases?.redis?.[0]).toMatchObject({ name: "cache", externalPort: 6379 });
		expect("databaseUser" in (manifest.databases?.redis?.[0] ?? {})).toBe(false);
		expect(
			notes.some((note) => note.message.includes('Server "db-host" does not exist here')),
		).toBe(true);
	});

	it("skips unsupported engines and counts everything", () => {
		const { notes, counts } = normalize();
		expect(notes.some((note) => note.service === "libsql/edge")).toBe(true);
		expect(counts).toEqual({ applications: 1, compose: 1, databases: 2, domains: 3, skipped: 2 });
	});

	it("can drop the source appNames and rename the target", () => {
		const { manifest, secrets } = normalize({
			keepAppNames: false,
			targetProjectName: "shop-eu",
			targetEnvironmentName: "prod",
		});
		expect(manifest.applications?.[0]?.appName).toBeUndefined();
		expect(manifest.databases?.postgres?.[0]?.appName).toBeUndefined();
		expect(manifest.project.name).toBe("shop-eu");
		expect(manifest.applications?.[0]?.environment).toBe("prod");
		expect(secrets.project.name).toBe("shop-eu");
		expect(secrets.environment.name).toBe("prod");
	});
});
