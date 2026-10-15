import type {
	GitopsApplication,
	GitopsCompose,
	GitopsDomain,
	GitopsMount,
	GitopsSwarm,
	NixployStack,
} from "../gitops/schema";
import { envKeysFromDotenv, NIXPLOY_STACK_VERSION } from "../gitops/schema";
import { SECRETS_BUNDLE_VERSION, type SecretsPayload } from "../gitops/secrets";
import { assertSafeVolumeName } from "../services/mounts";
import { DATABASE_KINDS, type DatabaseServiceKind } from "../services/registry";
import type {
	SourceApplication,
	SourceCompose,
	SourceDatabase,
	SourceDomain,
	SourceEnvironmentSummary,
	SourceMount,
	SourceProjectSummary,
} from "./source-schema";

/**
 * Pure mapping from one source environment to the two files a move needs:
 * a version-2 manifest (keys, never values) and the secrets payload the
 * `gitops.applySecrets` path writes. Nothing here touches the database or
 * the network, so the whole translation is unit-tested on fixtures.
 *
 * What does not translate is written down rather than dropped silently:
 * every {@link ImportNote} names the service and says what the operator has
 * to do by hand. The rule for the manifest itself is "only what apply will
 * accept" — a basic-auth entry without its password, or a compose mount
 * without a container name, would fail the apply for the whole service, so
 * those become notes instead of rows.
 */

export interface ImportNote {
	level: "info" | "warn";
	/** `application/web`, `compose/stack`, `postgres/main`, or unset for the environment. */
	service?: string;
	message: string;
}

export interface NormalizeInput {
	project: SourceProjectSummary;
	environment: SourceEnvironmentSummary;
	applications: SourceApplication[];
	compose: SourceCompose[];
	databases: Record<DatabaseServiceKind, SourceDatabase[]>;
	/** Names of the target's servers and registries, for the by-name references. */
	knownServers: ReadonlySet<string>;
	knownRegistries: ReadonlySet<string>;
	/** Names to use on this side; default to the source's. */
	targetProjectName?: string;
	targetEnvironmentName?: string;
	/**
	 * Keep the source's `appName` (the name of the Swarm service, its volumes
	 * and its Traefik keys). On a fresh instance that is what makes a later
	 * same-host takeover find the old volumes; when the name is taken here,
	 * the apply reports it and the operator drops this flag.
	 */
	keepAppNames?: boolean;
}

export interface NormalizedEnvironment {
	manifest: NixployStack;
	secrets: SecretsPayload;
	notes: ImportNote[];
	counts: {
		applications: number;
		compose: number;
		databases: number;
		domains: number;
		skipped: number;
	};
}

const SOURCE_TYPES = new Set(["docker", "git", "github", "gitlab", "bitbucket", "gitea", "drop"]);
const COMPOSE_SOURCE_TYPES = new Set(["raw", "git", "github", "gitlab", "bitbucket", "gitea"]);
const BUILD_TYPES = new Set([
	"dockerfile",
	"heroku_buildpacks",
	"paketo_buildpacks",
	"nixpacks",
	"static",
	"railpack",
]);

const orNull = (value: string | null | undefined): string | null =>
	value === undefined || value === null || value === "" ? null : value;

/** Adapters explicitly mark unreadable secrets and unsupported settings for preservation. */
const preserveUnavailable = <T extends object>(
	value: T,
	row: { unavailableFields?: string[] },
): T => {
	for (const field of row.unavailableFields ?? []) delete (value as Record<string, unknown>)[field];
	return value;
};

const sourceEnv = (
	row: {
		unavailableFields?: string[];
		env?: string | null;
		buildArgs?: string | null;
		previewEnv?: string | null;
	},
	field: "env" | "buildArgs" | "previewEnv",
	notes: ImportNote[],
	label: string,
	service?: string,
) =>
	row.unavailableFields?.includes(field)
		? undefined
		: readableEnv(row[field], notes, label, service);

/** Ciphertext hides the key names too; never mistake its base64 padding for dotenv. */
const readableEnv = (
	value: string | null | undefined,
	notes: ImportNote[],
	label: string,
	service?: string,
): string | null | undefined => {
	if (value && /^enc:v\d+:/.test(value)) {
		notes.push({
			level: "warn",
			...(service ? { service } : {}),
			message: `${label} is encrypted in the source dump; its keys and values cannot be read — paste them here before deploying. Existing target values are kept`,
		});
		return undefined;
	}
	return value === undefined ? null : orNull(value);
};

const swarmOf = (row: {
	healthCheckSwarm?: unknown;
	restartPolicySwarm?: unknown;
	placementSwarm?: unknown;
	updateConfigSwarm?: unknown;
	rollbackConfigSwarm?: unknown;
	modeSwarm?: unknown;
	labelsSwarm?: unknown;
	networkSwarm?: unknown;
}): GitopsSwarm | undefined => {
	const swarm: Record<string, unknown> = {};
	const pairs: Array<[keyof GitopsSwarm, unknown]> = [
		["healthCheck", row.healthCheckSwarm],
		["restartPolicy", row.restartPolicySwarm],
		["placement", row.placementSwarm],
		["updateConfig", row.updateConfigSwarm],
		["rollbackConfig", row.rollbackConfigSwarm],
		["mode", row.modeSwarm],
		["labels", row.labelsSwarm],
		["network", row.networkSwarm],
	];
	for (const [key, value] of pairs) {
		if (value !== undefined && value !== null) swarm[key] = value;
	}
	return Object.keys(swarm).length > 0 ? (swarm as GitopsSwarm) : undefined;
};

const referenceByName = (
	name: string | null | undefined,
	known: ReadonlySet<string>,
	notes: ImportNote[],
	service: string,
	what: string,
): string | null => {
	if (!name) return null;
	if (known.has(name)) return name;
	notes.push({
		level: "warn",
		service,
		message: `${what} "${name}" does not exist here — create it with that name before applying, or the service lands without it`,
	});
	return null;
};

const mapDomains = (
	rows: SourceDomain[],
	service: string,
	notes: ImportNote[],
	compose: boolean,
): GitopsDomain[] => {
	const domains: GitopsDomain[] = [];
	for (const row of rows) {
		if (row.previewDeploymentId) continue;
		const certificateType =
			row.certificateType === "letsencrypt" || row.certificateType === "none"
				? row.certificateType
				: "none";
		if (row.certificateType === "custom") {
			notes.push({
				level: "warn",
				service,
				message: `${row.host}: used a custom certificate; imported with certificateType none — upload the certificate here and attach it`,
			});
		}
		if (row.customCertResolver) {
			notes.push({
				level: "info",
				service,
				message: `${row.host}: the custom ACME resolver "${row.customCertResolver}" is not carried; the default Let's Encrypt resolver applies`,
			});
		}
		if (row.stripPath) {
			notes.push({
				level: "warn",
				service,
				message: `${row.host}${row.path ?? ""}: "strip path" is not supported; the path reaches the container unchanged`,
			});
		}
		domains.push({
			host: row.host,
			path: row.path ?? "/",
			port: row.port ?? null,
			https: row.https ?? false,
			certificateType,
			serviceName: compose ? (row.serviceName ?? null) : null,
			internalPath: row.internalPath && row.internalPath !== "/" ? row.internalPath : null,
		});
	}
	return domains;
};

const mapMounts = (
	rows: SourceMount[],
	service: string,
	notes: ImportNote[],
	compose: boolean,
	appName?: string,
): { mounts?: GitopsMount[]; skipped: number } => {
	const mounts: GitopsMount[] = [];
	let skipped = 0;
	for (const row of rows) {
		if (compose) {
			// The source attaches a compose mount to the stack; here a mount
			// names the container it goes in, and there is no way to guess it.
			notes.push({
				level: "warn",
				service,
				message: `mount ${row.mountPath} (${row.type}) skipped: a compose mount here names the container it belongs to — add it under the stack's Advanced tab`,
			});
			skipped += 1;
			continue;
		}
		if (row.type === "file") {
			notes.push({
				level: "warn",
				service,
				message: `file mount ${row.mountPath} skipped: recreate the file and its contents in the target's Advanced tab before deploying; import does not write or remove backing files used by running services`,
			});
			skipped += 1;
			continue;
		}
		if (row.type === "volume") {
			let compatible = Boolean(appName);
			if (appName) {
				try {
					assertSafeVolumeName(row.volumeName, appName);
				} catch {
					compatible = false;
				}
			}
			if (!compatible) {
				notes.push({
					level: "warn",
					service,
					message: `volume mount ${row.mountPath} skipped: ${row.volumeName ?? "its volume"} cannot be attached under the target app name — create an application-scoped volume and restore its data before deploying`,
				});
				skipped += 1;
				continue;
			}
		}
		if (row.type === "bind") {
			notes.push({
				level: "info",
				service,
				message: `mount ${row.mountPath} binds ${row.hostPath ?? "?"} on the host — bind mounts need the instance admin to apply`,
			});
		}
		mounts.push({
			type: row.type,
			mountPath: row.mountPath,
			hostPath: row.type === "bind" ? orNull(row.hostPath) : undefined,
			volumeName: row.type === "volume" ? orNull(row.volumeName) : undefined,
		});
	}
	if (skipped > 0) {
		// A v2 collection is authoritative. Emitting only the translatable
		// rows would delete mounts the operator supplied for the skipped ones
		// on a repeat import, including their restored data volumes.
		notes.push({
			level: "warn",
			service,
			message:
				"Mounts need manual setup because some source mounts cannot be translated; existing target mounts are kept and no mount rows are imported",
		});
		return { skipped: rows.length };
	}
	return { mounts, skipped };
};

/** A string column read off a row the schema left untyped (`passthrough`). */
const stringField = (row: object, key: string): string | undefined => {
	const value = (row as Record<string, unknown>)[key];
	return typeof value === "string" && value !== "" ? value : undefined;
};

const gitFields = (
	row: SourceApplication | SourceCompose,
	sourceType: string,
): {
	repository: string | null;
	owner: string | null;
	branch: string | null;
	buildPath?: string;
} => {
	switch (sourceType) {
		case "gitlab":
			return {
				repository: orNull(row.gitlabRepository),
				owner: orNull(row.gitlabOwner),
				branch: orNull(row.gitlabBranch),
				buildPath: stringField(row, "gitlabBuildPath"),
			};
		case "gitea":
			return {
				repository: orNull(row.giteaRepository),
				owner: orNull(row.giteaOwner),
				branch: orNull(row.giteaBranch),
				buildPath: stringField(row, "giteaBuildPath"),
			};
		case "bitbucket":
			return {
				repository: orNull(row.bitbucketRepository),
				owner: orNull(row.bitbucketOwner),
				branch: orNull(row.bitbucketBranch),
				buildPath: stringField(row, "bitbucketBuildPath"),
			};
		default:
			return {
				repository: orNull(row.repository),
				owner: orNull(row.owner),
				branch: orNull(row.branch),
				buildPath: stringField(row, "buildPath"),
			};
	}
};

const mapApplication = (
	row: SourceApplication,
	environmentName: string,
	input: NormalizeInput,
	notes: ImportNote[],
): { application: GitopsApplication; skippedMounts: number } => {
	const service = `application/${row.name}`;
	const sourceType = row.sourceType && SOURCE_TYPES.has(row.sourceType) ? row.sourceType : "git";
	const buildType = row.buildType && BUILD_TYPES.has(row.buildType) ? row.buildType : "nixpacks";
	const git = gitFields(row, sourceType);

	if (
		sourceType === "github" ||
		sourceType === "gitlab" ||
		sourceType === "bitbucket" ||
		sourceType === "gitea"
	) {
		notes.push({
			level: "warn",
			service,
			message: `deploys from ${sourceType} (${git.owner ?? "?"}/${git.repository ?? "?"}); connect that provider here (Settings → Git providers) and select it on the service before the first deploy`,
		});
	}
	if (sourceType === "drop") {
		notes.push({
			level: "warn",
			service,
			message:
				"was deployed from an uploaded archive; upload it again here (the archive is not carried)",
		});
	}
	if (sourceType === "docker" && (row.username || row.password)) {
		notes.push({
			level: "warn",
			service,
			message: `pulls ${row.dockerImage ?? "its image"} with inline registry credentials; add the registry under Settings → Registries and select it on the service`,
		});
	}
	if (row.enableSubmodules) {
		notes.push({ level: "info", service, message: "git submodules are not fetched here" });
	}
	if (row.security.length > 0) {
		notes.push({
			level: "warn",
			service,
			message: `basic auth for ${row.security.map((entry) => entry.username).join(", ")} is not carried (the source stores hashes); re-create the entries with their passwords`,
		});
	}
	const swarm = swarmOf(row);
	if (swarm?.network) {
		notes.push({
			level: "info",
			service,
			message: "carries a Swarm network override; applying it needs the instance admin",
		});
	}
	const { mounts, skipped } = mapMounts(
		row.mounts,
		service,
		notes,
		false,
		input.keepAppNames === false ? undefined : row.appName,
	);

	const application: GitopsApplication = {
		name: row.name,
		environment: environmentName,
		...(input.keepAppNames === false ? {} : { appName: row.appName }),
		description: orNull(row.description),
		sourceType: sourceType as GitopsApplication["sourceType"],
		buildType: buildType as GitopsApplication["buildType"],
		repository: git.repository,
		owner: git.owner,
		branch: git.branch,
		buildPath: git.buildPath ?? undefined,
		gitUrl: sourceType === "git" ? orNull(row.customGitUrl) : null,
		gitBranch: sourceType === "git" ? orNull(row.customGitBranch) : null,
		dockerImage: sourceType === "docker" ? orNull(row.dockerImage) : null,
		dockerfile: orNull(row.dockerfile),
		dockerContextPath: orNull(row.dockerContextPath),
		dockerBuildStage: orNull(row.dockerBuildStage),
		publishDirectory: orNull(row.publishDirectory),
		isStaticSpa: row.isStaticSpa ?? null,
		replicas: row.replicas ?? 1,
		command: orNull(row.command),
		memoryReservation: orNull(row.memoryReservation),
		memoryLimit: orNull(row.memoryLimit),
		cpuReservation: orNull(row.cpuReservation),
		cpuLimit: orNull(row.cpuLimit),
		autoDeploy: row.autoDeploy ?? true,
		watchPaths: row.watchPaths && row.watchPaths.length > 0 ? row.watchPaths : null,
		registry: referenceByName(
			row.registry?.registryName,
			input.knownRegistries,
			notes,
			service,
			"Registry",
		),
		pushRegistry: referenceByName(
			row.buildRegistry?.registryName,
			input.knownRegistries,
			notes,
			service,
			"Push registry",
		),
		server: referenceByName(row.server?.name, input.knownServers, notes, service, "Server"),
		...(swarm ? { swarm } : {}),
		previews: {
			enabled: row.isPreviewDeploymentsActive ?? false,
			limit: row.previewLimit ?? 3,
		},
		envKeys: envKeysFromDotenv(row.env),
		domains: mapDomains(row.domains, service, notes, false),
		mounts,
		ports: row.ports.map((port) => ({
			published: port.publishedPort,
			target: port.targetPort,
			protocol: port.protocol ?? "tcp",
			publishMode: port.publishMode ?? "ingress",
		})),
		redirects: row.redirects.map((redirect) => ({
			regex: redirect.regex,
			replacement: redirect.replacement,
			permanent: redirect.permanent ?? false,
		})),
	};
	if (row.isPreviewDeploymentsActive) {
		notes.push({
			level: "info",
			service,
			message:
				"preview deployments were on; the preview domain, port and path settings are not carried — check the Previews tab",
		});
	}
	return { application: preserveUnavailable(application, row), skippedMounts: skipped };
};

const mapCompose = (
	row: SourceCompose,
	environmentName: string,
	input: NormalizeInput,
	notes: ImportNote[],
): { compose: GitopsCompose; skippedMounts: number } => {
	const service = `compose/${row.name}`;
	const sourceType =
		row.sourceType && COMPOSE_SOURCE_TYPES.has(row.sourceType) ? row.sourceType : "raw";
	const git = gitFields(row, sourceType);
	if (
		sourceType === "github" ||
		sourceType === "gitlab" ||
		sourceType === "bitbucket" ||
		sourceType === "gitea"
	) {
		notes.push({
			level: "warn",
			service,
			message: `deploys from ${sourceType} (${git.owner ?? "?"}/${git.repository ?? "?"}); connect that provider here and select it on the stack before the first deploy`,
		});
	}
	if (row.command) {
		notes.push({
			level: "warn",
			service,
			message:
				"A custom Compose command was not carried; configure it manually in the stack's Advanced tab",
		});
	}
	if (row.enableSubmodules) {
		notes.push({ level: "info", service, message: "git submodules are not fetched here" });
	}
	const { mounts, skipped } = mapMounts(row.mounts, service, notes, true);
	const compose: GitopsCompose = {
		name: row.name,
		environment: environmentName,
		...(input.keepAppNames === false ? {} : { appName: row.appName }),
		description: orNull(row.description),
		composeType: row.composeType === "stack" ? "stack" : "docker-compose",
		sourceType: sourceType as GitopsCompose["sourceType"],
		composePath: row.composePath ?? undefined,
		...(sourceType === "raw" && row.composeFile ? { composeFile: row.composeFile } : {}),
		repository: git.repository,
		owner: git.owner,
		branch: git.branch,
		gitUrl: sourceType === "git" ? orNull(row.customGitUrl) : null,
		gitBranch: sourceType === "git" ? orNull(row.customGitBranch) : null,
		autoDeploy: row.autoDeploy ?? true,
		watchPaths: row.watchPaths && row.watchPaths.length > 0 ? row.watchPaths : null,
		// Either of the source's two isolation flags means "unique names" here.
		isolatedDeployment: Boolean(row.isolatedDeployment || row.randomize),
		...(row.suffix ? { suffix: row.suffix } : {}),
		server: referenceByName(row.server?.name, input.knownServers, notes, service, "Server"),
		envKeys: envKeysFromDotenv(row.env),
		domains: mapDomains(row.domains, service, notes, true),
		mounts,
	};
	return { compose: preserveUnavailable(compose, row), skippedMounts: skipped };
};

const mapDatabase = (
	kind: DatabaseServiceKind,
	row: SourceDatabase,
	environmentName: string,
	input: NormalizeInput,
	notes: ImportNote[],
) => {
	const service = `${kind}/${row.name}`;
	notes.push({
		level: "warn",
		service,
		message:
			"gets a new password here; update env values that carry the old one (DATABASE_URL and friends), and restore database data from a backup separately",
	});
	if (kind === "mongo" && row.replicaSets) {
		notes.push({
			level: "info",
			service,
			message: "ran as a replica set; enable that here after import",
		});
	}
	const swarm = swarmOf(row);
	if (swarm) {
		notes.push({
			level: "info",
			service,
			message: "Swarm overrides on databases are not part of the manifest and were not carried",
		});
	}
	return preserveUnavailable(
		{
			name: row.name,
			environment: environmentName,
			...(input.keepAppNames === false ? {} : { appName: row.appName }),
			description: orNull(row.description),
			...(row.dockerImage ? { dockerImage: row.dockerImage } : {}),
			externalPort: row.externalPort ?? null,
			command: orNull(row.command),
			memoryReservation: orNull(row.memoryReservation),
			memoryLimit: orNull(row.memoryLimit),
			cpuReservation: orNull(row.cpuReservation),
			cpuLimit: orNull(row.cpuLimit),
			server: referenceByName(row.server?.name, input.knownServers, notes, service, "Server"),
			envKeys: envKeysFromDotenv(row.env),
			...(kind !== "redis" && kind !== "mongo" && row.databaseName
				? { databaseName: row.databaseName }
				: {}),
			...(kind !== "redis" && row.databaseUser ? { databaseUser: row.databaseUser } : {}),
		},
		row,
	);
};

export function normalizeSourceEnvironment(source: NormalizeInput): NormalizedEnvironment {
	const notes: ImportNote[] = [];
	const input: NormalizeInput = {
		...source,
		project: {
			...source.project,
			env: sourceEnv(source.project, "env", notes, "Project env"),
		},
		environment: {
			...source.environment,
			env: sourceEnv(source.environment, "env", notes, "Environment env"),
		},
		applications: source.applications.map((row) => ({
			...row,
			env: sourceEnv(row, "env", notes, "Env", `application/${row.name}`),
			buildArgs: sourceEnv(row, "buildArgs", notes, "Build args", `application/${row.name}`),
			previewEnv: sourceEnv(row, "previewEnv", notes, "Preview env", `application/${row.name}`),
		})),
		compose: source.compose.map((row) => ({
			...row,
			env: sourceEnv(row, "env", notes, "Env", `compose/${row.name}`),
		})),
		databases: Object.fromEntries(
			DATABASE_KINDS.map((kind) => [
				kind,
				source.databases[kind].map((row) => ({
					...row,
					env: sourceEnv(row, "env", notes, "Env", `${kind}/${row.name}`),
				})),
			]),
		) as NormalizeInput["databases"],
	};
	const projectName = input.targetProjectName ?? input.project.name;
	const environmentName = input.targetEnvironmentName ?? input.environment.name;
	let skipped = 0;
	for (const row of input.environment.unsupportedResources) {
		notes.push({
			level: "warn",
			service: `${row.kind}/${row.name}`,
			message: `${row.kind} is not supported by this import and was skipped; recreate it and restore its data separately`,
		});
		skipped += 1;
	}

	for (const row of input.environment.libsql) {
		notes.push({
			level: "warn",
			service: `libsql/${row.name}`,
			message: "libSQL databases have no counterpart here and were skipped",
		});
		skipped += 1;
	}

	const applications = input.applications.map((row) => {
		const mapped = mapApplication(row, environmentName, input, notes);
		skipped += mapped.skippedMounts;
		return mapped.application;
	});
	const compose = input.compose.map((row) => {
		const mapped = mapCompose(row, environmentName, input, notes);
		skipped += mapped.skippedMounts;
		return mapped.compose;
	});
	const databases = Object.fromEntries(
		DATABASE_KINDS.map((kind) => [
			kind,
			input.databases[kind].map((row) => mapDatabase(kind, row, environmentName, input, notes)),
		]),
	) as NonNullable<NixployStack["databases"]>;

	const manifest: NixployStack = {
		version: NIXPLOY_STACK_VERSION,
		project: { name: projectName, envKeys: envKeysFromDotenv(input.project.env) },
		environment: {
			name: environmentName,
			description: orNull(input.environment.description),
			envKeys: envKeysFromDotenv(input.environment.env),
		},
		applications,
		compose,
		databases,
	};

	const secrets: SecretsPayload = {
		version: SECRETS_BUNDLE_VERSION,
		project: { name: projectName, env: input.project.env },
		environment: { name: environmentName, env: input.environment.env },
		applications: Object.fromEntries(
			input.applications.map((row) => [
				row.name,
				{
					env: row.env,
					buildArgs: row.buildArgs,
					previewEnv: row.previewEnv,
				},
			]),
		),
		compose: Object.fromEntries(input.compose.map((row) => [row.name, { env: row.env }])),
		databases: Object.fromEntries(
			DATABASE_KINDS.map((kind) => [
				kind,
				Object.fromEntries(input.databases[kind].map((row) => [row.name, { env: row.env }])),
			]),
		),
	};

	const databaseCount = DATABASE_KINDS.reduce((sum, kind) => sum + input.databases[kind].length, 0);
	const domainCount =
		applications.reduce((sum, app) => sum + (app.domains?.length ?? 0), 0) +
		compose.reduce((sum, stack) => sum + (stack.domains?.length ?? 0), 0);

	return {
		manifest,
		secrets,
		notes,
		counts: {
			applications: applications.length,
			compose: compose.length,
			databases: databaseCount,
			domains: domainCount,
			skipped,
		},
	};
}
