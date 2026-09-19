import { parse, stringify } from "yaml";
import { z } from "zod";
import { mountContentSchema, textBlobSchema, watchPathsSchema } from "../../utils/input-limits";
import {
	labelsSwarmSchema,
	modeSwarmSchema,
	networkSwarmSchema,
	privilegesSwarmSchema,
	restartPolicySwarmSchema,
	rollbackConfigSwarmSchema,
	updateConfigSwarmSchema,
} from "../../utils/swarm-overrides";
import {
	appNameSchema,
	assertComposeServiceName,
	assertSafeDockerImageRef,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import { badRequest } from "../errors";
import { validateMountFields } from "../services/mounts";
import {
	DOMAIN_MIDDLEWARE_CONFIG_SCHEMAS,
	domainMiddlewareKindSchema,
} from "../traefik/middlewares";

/**
 * nixploy.yaml, version 2.
 *
 * Version 1 covered the service rows and their domains. Version 2 covers the
 * rest of what a service is: deploy hooks, Swarm overrides, mounts, published
 * ports, redirects, basic auth, domain middlewares, preview settings and the
 * references a row holds by id (registry, push registry, server), written by
 * NAME so the file survives a move between instances. Every v1 file is a
 * valid v2 file: nothing was renamed, only added, and `upgradeStack` bumps
 * the number.
 *
 * Three rules hold everywhere in the file:
 * - an omitted scalar means "leave as is", never "reset";
 * - an array (`domains`, `mounts`, `ports`, `redirects`, `basicAuth`,
 *   `middlewares`) is the whole desired set — `[]` removes every row — and an
 *   omitted array leaves the rows alone;
 * - values never enter the file: env is keys only, basic-auth passwords are
 *   write-only (never exported), and hook commands, inline compose files and
 *   file-mount contents are exported only to a caller holding `secrets.read`.
 */

export const NIXPLOY_STACK_VERSION = 2;
export const SUPPORTED_STACK_VERSIONS = [1, 2] as const;

const issueFrom = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

const safeDockerImageSchema = z
	.string()
	.min(1)
	.transform((value, ctx) => {
		try {
			return assertSafeDockerImageRef(value);
		} catch (error) {
			ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid docker image") });
			return z.NEVER;
		}
	});

/** A row referenced by name (registry, server); `null` clears the reference. */
const nameRefSchema = z.string().min(1).max(200).nullable().optional();

/** Compose rows carry the container a mount/redirect/auth entry belongs to. */
const serviceNameSchema = z
	.string()
	.min(1)
	.max(63)
	.nullable()
	.optional()
	.superRefine((value, ctx) => {
		if (!value) return;
		try {
			assertComposeServiceName(value);
		} catch (error) {
			ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid serviceName") });
		}
	});

const traefikPathSchema = z
	.string()
	.min(1)
	.optional()
	.transform((value, ctx) => {
		if (value === undefined) return value;
		try {
			return assertTraefikPath(value) ?? "/";
		} catch (error) {
			ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid path") });
			return z.NEVER;
		}
	});

// ─── Domains ─────────────────────────────────────────────────────────────────

/**
 * One middleware of a domain's chain. The config is checked against its
 * kind's schema at parse time so a bad manifest fails before plan, the same
 * way the panel form fails before save; the organization-bound checks
 * (forwardAuth targets, panel-auth team/user ids) run at apply.
 */
export const gitopsMiddlewareSchema = z
	.object({
		kind: domainMiddlewareKindSchema,
		config: z.unknown().optional(),
		enabled: z.boolean().optional(),
	})
	.superRefine((value, ctx) => {
		const result = DOMAIN_MIDDLEWARE_CONFIG_SCHEMAS[value.kind].safeParse(value.config ?? {});
		if (!result.success) {
			const issue = result.error.issues[0];
			const path = issue?.path.join(".");
			ctx.addIssue({
				code: "custom",
				message: `Invalid ${value.kind} middleware: ${path ? `${path} — ` : ""}${issue?.message ?? "invalid config"}`,
			});
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
				ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid host") });
				return z.NEVER;
			}
		}),
	path: traefikPathSchema,
	port: z.number().int().min(1).max(65535).nullable().optional(),
	https: z.boolean().optional(),
	certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
	serviceName: serviceNameSchema,
	/** Path the request is rewritten to before it reaches the container. */
	internalPath: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.superRefine((value, ctx) => {
			if (value === undefined || value === null) return;
			try {
				assertTraefikPath(value);
			} catch (error) {
				ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid internalPath") });
			}
		}),
	/** The whole middleware chain, in order. `[]` detaches every middleware. */
	middlewares: z.array(gitopsMiddlewareSchema).max(20).optional(),
});

// ─── Per-service collections ─────────────────────────────────────────────────

export const gitopsMountSchema = z
	.object({
		type: z.enum(["bind", "volume", "file"]),
		/** Container-side path; the key a mount is matched on. */
		mountPath: z.string().min(1).max(4096),
		hostPath: z.string().max(4096).nullable().optional(),
		volumeName: z.string().max(255).nullable().optional(),
		filePath: z.string().max(4096).nullable().optional(),
		/** File mounts only; omitted = keep what is stored. */
		content: mountContentSchema.nullable().optional(),
		serviceName: serviceNameSchema,
	})
	.superRefine((value, ctx) => {
		try {
			validateMountFields(value);
		} catch (error) {
			ctx.addIssue({ code: "custom", message: issueFrom(error, "Invalid mount") });
		}
	});

export const gitopsPortSchema = z.object({
	published: z.number().int().min(1).max(65535),
	target: z.number().int().min(1).max(65535),
	protocol: z.enum(["tcp", "udp"]).optional(),
	publishMode: z.enum(["ingress", "host"]).optional(),
});

export const gitopsRedirectSchema = z.object({
	regex: z.string().min(1).max(256),
	replacement: z.string().min(1).max(512),
	permanent: z.boolean().optional(),
	serviceName: serviceNameSchema,
});

export const gitopsBasicAuthSchema = z.object({
	username: z.string().min(1).max(128),
	/** Required when the entry is new; omitted on an existing one keeps the stored hash. */
	password: z.string().min(1).max(1024).optional(),
	serviceName: serviceNameSchema,
});

export const gitopsHooksSchema = z.object({
	preDeploy: textBlobSchema.nullable().optional(),
	postDeploy: textBlobSchema.nullable().optional(),
});

export const gitopsSwarmSchema = z.object({
	healthCheck: z.unknown().nullable().optional(),
	restartPolicy: restartPolicySwarmSchema.nullable().optional(),
	placement: z.unknown().nullable().optional(),
	updateConfig: updateConfigSwarmSchema.nullable().optional(),
	rollbackConfig: rollbackConfigSwarmSchema.nullable().optional(),
	mode: modeSwarmSchema.nullable().optional(),
	labels: labelsSwarmSchema.nullable().optional(),
	network: networkSwarmSchema.nullable().optional(),
	privileges: privilegesSwarmSchema.nullable().optional(),
});

export const gitopsPreviewsSchema = z.object({
	enabled: z.boolean().optional(),
	forksRequireApproval: z.boolean().optional(),
	limit: z.number().int().min(0).max(100).optional(),
	ttlHours: z.number().int().min(1).max(8760).nullable().optional(),
});

/** Manifest key → row column, for the three nested groups. */
export const HOOK_COLUMNS = {
	preDeploy: "preDeployCommand",
	postDeploy: "postDeployCommand",
} as const;

export const SWARM_COLUMNS = {
	healthCheck: "healthCheckSwarm",
	restartPolicy: "restartPolicySwarm",
	placement: "placementSwarm",
	updateConfig: "updateConfigSwarm",
	rollbackConfig: "rollbackConfigSwarm",
	mode: "modeSwarm",
	labels: "labelsSwarm",
	network: "networkSwarm",
	privileges: "privilegesSwarm",
} as const;

export const PREVIEW_COLUMNS = {
	enabled: "isPreviewDeploymentsActive",
	forksRequireApproval: "previewForksRequireApproval",
	limit: "previewLimit",
	ttlHours: "previewTtlHours",
} as const;

// ─── Project / environment ───────────────────────────────────────────────────

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

// ─── Services ────────────────────────────────────────────────────────────────

const requireServiceNames = (
	label: string,
	entries: Array<{ serviceName?: string | null }> | undefined,
	ctx: z.RefinementCtx,
) => {
	entries?.forEach((entry, index) => {
		if (!entry.serviceName) {
			ctx.addIssue({
				code: "custom",
				path: [label, index, "serviceName"],
				message: `serviceName is required for a compose ${label} entry — a stack has more than one container`,
			});
		}
	});
};

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
	dockerfile: z.string().nullable().optional(),
	dockerContextPath: z.string().max(4096).nullable().optional(),
	dockerBuildStage: z.string().max(255).nullable().optional(),
	useBuildCache: z.boolean().optional(),
	publishDirectory: z.string().max(4096).nullable().optional(),
	isStaticSpa: z.boolean().nullable().optional(),
	replicas: z.number().int().min(0).optional(),
	command: z.string().nullable().optional(),
	memoryReservation: z.string().nullable().optional(),
	memoryLimit: z.string().nullable().optional(),
	cpuReservation: z.string().nullable().optional(),
	cpuLimit: z.string().nullable().optional(),
	autoDeploy: z.boolean().optional(),
	autoUpdateImage: z.boolean().optional(),
	watchPaths: watchPathsSchema.nullable().optional(),
	/** Pull registry, by its name in Settings → Registries. */
	registry: nameRefSchema,
	/** Registry the built image is pushed to, by name (needs an image prefix). */
	pushRegistry: nameRefSchema,
	/** Server the tasks are pinned to, by name; `null` is the primary. */
	server: nameRefSchema,
	hooks: gitopsHooksSchema.optional(),
	swarm: gitopsSwarmSchema.optional(),
	previews: gitopsPreviewsSchema.optional(),
	envKeys: z.array(z.string()).optional(),
	domains: z.array(gitopsDomainSchema).optional(),
	mounts: z.array(gitopsMountSchema).max(100).optional(),
	ports: z.array(gitopsPortSchema).max(100).optional(),
	redirects: z.array(gitopsRedirectSchema).max(100).optional(),
	basicAuth: z.array(gitopsBasicAuthSchema).max(100).optional(),
});

export const gitopsComposeSchema = z
	.object({
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
		watchPaths: watchPathsSchema.nullable().optional(),
		buildEnabled: z.boolean().optional(),
		/** Turning this on is instance-admin only, like the panel switch. */
		publishPorts: z.boolean().optional(),
		isolatedDeployment: z.boolean().optional(),
		suffix: z
			.string()
			.regex(/^[a-z0-9-]{0,16}$/, "suffix must be lowercase a-z0-9- (max 16 chars)")
			.optional(),
		server: nameRefSchema,
		hooks: gitopsHooksSchema.optional(),
		previews: gitopsPreviewsSchema.optional(),
		envKeys: z.array(z.string()).optional(),
		domains: z.array(gitopsDomainSchema).optional(),
		mounts: z.array(gitopsMountSchema).max(100).optional(),
		redirects: z.array(gitopsRedirectSchema).max(100).optional(),
		basicAuth: z.array(gitopsBasicAuthSchema).max(100).optional(),
	})
	.superRefine((value, ctx) => {
		requireServiceNames("mounts", value.mounts, ctx);
		requireServiceNames("redirects", value.redirects, ctx);
		requireServiceNames("basicAuth", value.basicAuth, ctx);
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
	server: nameRefSchema,
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

/**
 * Services are matched to live rows by `(kind, environment, name)`; a
 * manifest listing the same key twice would create two rows on the first
 * apply and only ever match one afterwards.
 */
export function findDuplicateStackEntries(stack: {
	applications?: Array<{ name: string; environment: string }>;
	compose?: Array<{ name: string; environment: string }>;
	databases?: Partial<Record<string, Array<{ name: string; environment: string }>>>;
}): string[] {
	const seen = new Set<string>();
	const duplicates: string[] = [];
	const visit = (kind: string, entries: Array<{ name: string; environment: string }> = []) => {
		for (const entry of entries) {
			const key = `${kind}/${entry.environment}/${entry.name}`;
			if (seen.has(key)) duplicates.push(key);
			seen.add(key);
		}
	};
	visit("application", stack.applications);
	visit("compose", stack.compose);
	for (const [kind, entries] of Object.entries(stack.databases ?? {})) {
		visit(kind, entries);
	}
	return duplicates;
}

export const nixployStackSchema = z
	.object({
		version: z.union([z.literal(1), z.literal(2)]),
		project: gitopsProjectSchema,
		environment: gitopsEnvironmentSchema.optional(),
		environments: z.array(gitopsEnvironmentSchema).optional(),
		applications: z.array(gitopsApplicationSchema).optional(),
		compose: z.array(gitopsComposeSchema).optional(),
		databases: gitopsDatabasesSchema,
	})
	.superRefine((stack, ctx) => {
		const duplicates = findDuplicateStackEntries(stack);
		if (duplicates.length > 0) {
			ctx.addIssue({
				code: "custom",
				message: `Duplicate stack entries (kind/environment/name): ${duplicates.join(", ")}`,
			});
		}
	});

export type NixployStack = z.infer<typeof nixployStackSchema>;
export type GitopsApplication = z.infer<typeof gitopsApplicationSchema>;
export type GitopsCompose = z.infer<typeof gitopsComposeSchema>;
export type GitopsDomain = z.infer<typeof gitopsDomainSchema>;
export type GitopsMiddleware = z.infer<typeof gitopsMiddlewareSchema>;
export type GitopsMount = z.infer<typeof gitopsMountSchema>;
export type GitopsPort = z.infer<typeof gitopsPortSchema>;
export type GitopsRedirect = z.infer<typeof gitopsRedirectSchema>;
export type GitopsBasicAuth = z.infer<typeof gitopsBasicAuthSchema>;
export type GitopsHooks = z.infer<typeof gitopsHooksSchema>;
export type GitopsSwarm = z.infer<typeof gitopsSwarmSchema>;
export type GitopsPreviews = z.infer<typeof gitopsPreviewsSchema>;

/**
 * Bring a parsed stack to the current version.
 *
 * v1 renamed nothing, but it read an omitted `domains` as "no domains" and
 * deleted the live rows; v2 reads an omitted array as "leave them alone".
 * A v1 file therefore gets `domains: []` spelled out on every service that
 * left it out, so it keeps doing exactly what it did.
 */
export const upgradeStack = (stack: NixployStack): NixployStack => {
	if (stack.version === NIXPLOY_STACK_VERSION) return stack;
	const withDomains = <T extends { domains?: unknown[] }>(service: T): T =>
		service.domains === undefined ? { ...service, domains: [] } : service;
	return {
		...stack,
		version: NIXPLOY_STACK_VERSION,
		applications: stack.applications?.map(withDomains),
		compose: stack.compose?.map(withDomains),
	};
};

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
			throw badRequest("Invalid stack file: expected YAML or JSON");
		}
	}
	return upgradeStack(nixployStackSchema.parse(parsed));
};

export const serializeStackYaml = (stack: NixployStack): string =>
	stringify(stack, { lineWidth: 0, sortMapEntries: true });

export const parseStackInput = (input: { stack?: NixployStack; yaml?: string }): NixployStack => {
	if (input.stack) {
		return upgradeStack(nixployStackSchema.parse(input.stack));
	}
	if (input.yaml) {
		return parseStackYaml(input.yaml);
	}
	throw badRequest("Provide stack or yaml");
};
