import { parse, stringify } from "yaml";
import { z } from "zod";
import {
	appNameSchema,
	assertComposeServiceName,
	assertSafeDockerImageRef,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";

export const NIXPLOY_STACK_VERSION = 1;

const safeDockerImageSchema = z
	.string()
	.min(1)
	.transform((value, ctx) => {
		try {
			return assertSafeDockerImageRef(value);
		} catch (error) {
			ctx.addIssue({
				code: "custom",
				message: error instanceof Error ? error.message : "Invalid docker image",
			});
			return z.NEVER;
		}
	});

export const gitopsDomainSchema = z.object({
	host: z
		.string()
		.min(1)
		.max(255)
		.transform((value, ctx) => {
			try {
				return assertTraefikHost(value);
			} catch (error) {
				ctx.addIssue({
					code: "custom",
					message: error instanceof Error ? error.message : "Invalid host",
				});
				return z.NEVER;
			}
		}),
	path: z
		.string()
		.min(1)
		.optional()
		.transform((value, ctx) => {
			if (value === undefined) return value;
			try {
				return assertTraefikPath(value) ?? "/";
			} catch (error) {
				ctx.addIssue({
					code: "custom",
					message: error instanceof Error ? error.message : "Invalid path",
				});
				return z.NEVER;
			}
		}),
	port: z.number().int().min(1).max(65535).nullable().optional(),
	https: z.boolean().optional(),
	certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
	serviceName: z
		.string()
		.nullable()
		.optional()
		.superRefine((value, ctx) => {
			if (!value) return;
			try {
				assertComposeServiceName(value);
			} catch (error) {
				ctx.addIssue({
					code: "custom",
					message: error instanceof Error ? error.message : "Invalid serviceName",
				});
			}
		}),
});

export const gitopsEnvironmentSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable().optional(),
	envKeys: z.array(z.string()).optional(),
});

export const gitopsProjectSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	envKeys: z.array(z.string()).optional(),
});

export const gitopsApplicationSchema = z.object({
	name: z.string().min(1),
	environment: z.string().min(1),
	appName: appNameSchema.optional(),
	description: z.string().nullable().optional(),
	buildType: z
		.enum([
			"dockerfile",
			"heroku_buildpacks",
			"paketo_buildpacks",
			"nixpacks",
			"static",
			"railpack",
		])
		.optional(),
	sourceType: z
		.enum(["docker", "git", "github", "gitlab", "bitbucket", "gitea", "drop"])
		.optional(),
	repository: z.string().nullable().optional(),
	owner: z.string().nullable().optional(),
	branch: z.string().nullable().optional(),
	buildPath: z.string().optional(),
	dockerImage: safeDockerImageSchema.nullable().optional(),
	replicas: z.number().int().min(0).optional(),
	command: z.string().nullable().optional(),
	memoryReservation: z.string().nullable().optional(),
	memoryLimit: z.string().nullable().optional(),
	cpuReservation: z.string().nullable().optional(),
	cpuLimit: z.string().nullable().optional(),
	autoDeploy: z.boolean().optional(),
	dockerfile: z.string().nullable().optional(),
	envKeys: z.array(z.string()).optional(),
	domains: z.array(gitopsDomainSchema).optional(),
});

export const gitopsComposeSchema = z.object({
	name: z.string().min(1),
	environment: z.string().min(1),
	appName: appNameSchema.optional(),
	description: z.string().nullable().optional(),
	composeType: z.enum(["docker-compose", "stack"]).optional(),
	sourceType: z.enum(["raw", "git", "github", "gitlab", "bitbucket", "gitea"]).optional(),
	composePath: z.string().optional(),
	composeFile: z.string().optional(),
	repository: z.string().nullable().optional(),
	owner: z.string().nullable().optional(),
	branch: z.string().nullable().optional(),
	autoDeploy: z.boolean().optional(),
	envKeys: z.array(z.string()).optional(),
	domains: z.array(gitopsDomainSchema).optional(),
});

const databaseBaseSchema = z.object({
	name: z.string().min(1),
	environment: z.string().min(1),
	appName: appNameSchema.optional(),
	description: z.string().nullable().optional(),
	dockerImage: safeDockerImageSchema.optional(),
	externalPort: z.number().int().min(1).max(65535).nullable().optional(),
	command: z.string().nullable().optional(),
	memoryReservation: z.string().nullable().optional(),
	memoryLimit: z.string().nullable().optional(),
	cpuReservation: z.string().nullable().optional(),
	cpuLimit: z.string().nullable().optional(),
	envKeys: z.array(z.string()).optional(),
});

export const gitopsPostgresSchema = databaseBaseSchema.extend({
	databaseName: z.string().min(1).optional(),
	databaseUser: z.string().min(1).optional(),
});

export const gitopsMysqlSchema = databaseBaseSchema.extend({
	databaseName: z.string().min(1).optional(),
	databaseUser: z.string().min(1).optional(),
});

export const gitopsMariadbSchema = databaseBaseSchema.extend({
	databaseName: z.string().min(1).optional(),
	databaseUser: z.string().min(1).optional(),
});

export const gitopsMongoSchema = databaseBaseSchema.extend({
	databaseUser: z.string().min(1).optional(),
});

export const gitopsRedisSchema = databaseBaseSchema;

export const gitopsDatabasesSchema = z
	.object({
		postgres: z.array(gitopsPostgresSchema).optional(),
		mysql: z.array(gitopsMysqlSchema).optional(),
		mariadb: z.array(gitopsMariadbSchema).optional(),
		mongo: z.array(gitopsMongoSchema).optional(),
		redis: z.array(gitopsRedisSchema).optional(),
	})
	.optional();

export const nixployStackSchema = z.object({
	version: z.literal(NIXPLOY_STACK_VERSION),
	project: gitopsProjectSchema,
	environment: gitopsEnvironmentSchema.optional(),
	environments: z.array(gitopsEnvironmentSchema).optional(),
	applications: z.array(gitopsApplicationSchema).optional(),
	compose: z.array(gitopsComposeSchema).optional(),
	databases: gitopsDatabasesSchema,
});

export type NixployStack = z.infer<typeof nixployStackSchema>;
export type GitopsApplication = z.infer<typeof gitopsApplicationSchema>;
export type GitopsCompose = z.infer<typeof gitopsComposeSchema>;
export type GitopsDomain = z.infer<typeof gitopsDomainSchema>;

/** Extract env var key names from a dotenv string (values are never exported). */
export const envKeysFromDotenv = (env: string | null | undefined): string[] =>
	Object.keys(
		env
			? env
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter((line) => line && !line.startsWith("#") && line.includes("="))
					.reduce<Record<string, true>>((acc, line) => {
						const key = line.slice(0, line.indexOf("=")).trim();
						if (key) acc[key] = true;
						return acc;
					}, {})
			: {},
	).sort();

export const slugifyProjectName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63) || "project";

export const parseStackYaml = (yaml: string): NixployStack => {
	let parsed: unknown;
	try {
		parsed = parse(yaml);
	} catch {
		try {
			parsed = JSON.parse(yaml);
		} catch {
			throw new Error("Invalid stack file: expected YAML or JSON");
		}
	}
	return nixployStackSchema.parse(parsed);
};

export const serializeStackYaml = (stack: NixployStack): string =>
	stringify(stack, { lineWidth: 0, sortMapEntries: true });

export const parseStackInput = (input: { stack?: NixployStack; yaml?: string }): NixployStack => {
	if (input.stack) {
		return nixployStackSchema.parse(input.stack);
	}
	if (input.yaml) {
		return parseStackYaml(input.yaml);
	}
	throw new Error("Provide stack or yaml");
};
