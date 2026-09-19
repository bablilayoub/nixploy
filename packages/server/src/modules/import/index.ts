import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, projects, registry, servers } from "../../db/schema";
import { badRequest, notFound } from "../errors";
import {
	type ApplyStackResult,
	applyStack,
	buildPlan,
	type GitopsPlanResult,
	liveStateFromGraph,
	loadEnvironmentGraph,
	type NixployStack,
} from "../gitops";
import { type ApplySecretsResult, applySecretsPayload } from "../gitops/secrets";
import { DATABASE_KINDS, type DatabaseServiceKind } from "../services/registry";
import { SourcePanelClient } from "./client";
import {
	type ImportNote,
	type NormalizedEnvironment,
	normalizeSourceEnvironment,
} from "./normalize";
import type { SourceApplication, SourceCompose, SourceDatabase } from "./source-schema";

export { SourcePanelClient } from "./client";
export type { ImportNote, NormalizedEnvironment } from "./normalize";
export { normalizeSourceEnvironment } from "./normalize";

/**
 * Import one environment from another panel over its API.
 *
 * Three steps, each honest about what it is: `inspect` lists what the key
 * can see; `plan` fetches one environment, translates it to a manifest plus
 * a secrets payload and diffs it against the target (every item is a create
 * when the target project does not exist yet); `apply` writes the rows,
 * the env values and nothing else — nothing is deployed, services land
 * `idle`, and the operator deploys when the notes have been dealt with.
 * The source API key exists for the duration of one call.
 */

export const IMPORT_SOURCES = ["dokploy"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportSourceOptions {
	source: ImportSource;
	url: string;
	apiKey: string;
}

export interface ImportRequest extends ImportSourceOptions {
	sourceProjectId: string;
	/** Environment of the source project; its first one when omitted. */
	sourceEnvironmentName?: string;
	/** Target project; created with the source project's name when omitted and absent. */
	projectId?: string;
	/** Target environment name; the source environment's name when omitted. */
	environmentName?: string;
	keepAppNames?: boolean;
}

export interface SourceInventory {
	host: string;
	projects: Array<{
		projectId: string;
		name: string;
		environments: Array<{
			name: string;
			applications: number;
			compose: number;
			databases: number;
			unsupported: number;
		}>;
	}>;
}

/** What the key can see, counted — nothing that could hold a value. */
export const inspectSource = async (options: ImportSourceOptions): Promise<SourceInventory> => {
	const client = await SourcePanelClient.connect(options);
	const rows = await client.listProjects();
	return {
		host: client.host,
		projects: rows.map((project) => ({
			projectId: project.projectId,
			name: project.name,
			environments: project.environments.map((environment) => ({
				name: environment.name,
				applications: environment.applications.length,
				compose: environment.compose.length,
				databases: DATABASE_KINDS.reduce((sum, kind) => sum + environment[kind].length, 0),
				unsupported: environment.libsql.length,
			})),
		})),
	};
};

interface FetchedEnvironment {
	client: SourcePanelClient;
	normalizedInput: Omit<
		Parameters<typeof normalizeSourceEnvironment>[0],
		| "knownServers"
		| "knownRegistries"
		| "targetProjectName"
		| "targetEnvironmentName"
		| "keepAppNames"
	>;
}

/** Read one source environment in full: the summary, then every service by id. */
const fetchSourceEnvironment = async (request: ImportRequest): Promise<FetchedEnvironment> => {
	const client = await SourcePanelClient.connect(request);
	const projectRows = await client.listProjects();
	const project = projectRows.find((row) => row.projectId === request.sourceProjectId);
	if (!project) {
		throw notFound(
			`Project ${request.sourceProjectId} is not visible to this API key on ${client.host}`,
		);
	}
	const environment = request.sourceEnvironmentName
		? project.environments.find((row) => row.name === request.sourceEnvironmentName)
		: project.environments[0];
	if (!environment) {
		throw notFound(
			request.sourceEnvironmentName
				? `Environment "${request.sourceEnvironmentName}" not found in source project "${project.name}"`
				: `Source project "${project.name}" has no environment`,
		);
	}

	// Sequential on purpose: a panel on a small box answers one `one` at a
	// time comfortably and ten in parallel with 502s.
	const applications: SourceApplication[] = [];
	for (const row of environment.applications) {
		applications.push(await client.getApplication(row.applicationId));
	}
	const compose: SourceCompose[] = [];
	for (const row of environment.compose) {
		compose.push(await client.getCompose(row.composeId));
	}
	const databases = {} as Record<DatabaseServiceKind, SourceDatabase[]>;
	for (const kind of DATABASE_KINDS) {
		databases[kind] = [];
		for (const row of environment[kind]) {
			const id = (row as Record<string, unknown>)[`${kind}Id`];
			if (typeof id !== "string") continue;
			databases[kind].push(await client.getDatabase(kind, id));
		}
	}
	return { client, normalizedInput: { project, environment, applications, compose, databases } };
};

const knownNames = async (
	organizationId: string,
): Promise<{ servers: Set<string>; registries: Set<string> }> => {
	const [serverRows, registryRows] = await Promise.all([
		db.query.servers.findMany({
			where: eq(servers.organizationId, organizationId),
			columns: { name: true },
		}),
		db.query.registry.findMany({
			where: eq(registry.organizationId, organizationId),
			columns: { registryName: true },
		}),
	]);
	return {
		servers: new Set(serverRows.map((row) => row.name)),
		registries: new Set(registryRows.map((row) => row.registryName)),
	};
};

export interface ImportTarget {
	/** Existing target project, or null when apply would create one. */
	projectId: string | null;
	projectName: string;
	environmentName: string;
	/** Whether apply creates the environment (and the project when `projectId` is null). */
	createsProject: boolean;
	createsEnvironment: boolean;
}

/** Resolve where the import lands, without writing anything. */
const resolveTarget = async (
	request: ImportRequest,
	organizationId: string,
	normalized: NormalizedEnvironment,
): Promise<ImportTarget> => {
	const environmentName = normalized.manifest.environment?.name ?? "production";
	if (request.projectId) {
		const project = await db.query.projects.findFirst({
			where: and(
				eq(projects.projectId, request.projectId),
				eq(projects.organizationId, organizationId),
			),
		});
		if (!project) throw notFound("Target project not found");
		const environment = await db.query.environments.findFirst({
			where: and(
				eq(environments.projectId, project.projectId),
				eq(environments.name, environmentName),
			),
		});
		return {
			projectId: project.projectId,
			projectName: project.name,
			environmentName,
			createsProject: false,
			createsEnvironment: !environment,
		};
	}
	const projectName = normalized.manifest.project.name;
	const existing = await db.query.projects.findFirst({
		where: and(eq(projects.organizationId, organizationId), eq(projects.name, projectName)),
	});
	if (existing) {
		const environment = await db.query.environments.findFirst({
			where: and(
				eq(environments.projectId, existing.projectId),
				eq(environments.name, environmentName),
			),
		});
		return {
			projectId: existing.projectId,
			projectName,
			environmentName,
			createsProject: false,
			createsEnvironment: !environment,
		};
	}
	return {
		projectId: null,
		projectName,
		environmentName,
		createsProject: true,
		createsEnvironment: true,
	};
};

export interface ImportPlan {
	source: { host: string; project: string; environment: string };
	target: ImportTarget;
	/** The manifest that would be applied: keys only, no values. */
	manifest: NixployStack;
	notes: ImportNote[];
	counts: NormalizedEnvironment["counts"];
	/** Diff against the target, or null when the target does not exist yet (everything is a create). */
	plan: GitopsPlanResult | null;
}

const normalizeRequest = async (
	request: ImportRequest,
	organizationId: string,
): Promise<{
	fetched: FetchedEnvironment;
	normalized: NormalizedEnvironment;
	target: ImportTarget;
}> => {
	const fetched = await fetchSourceEnvironment(request);
	const names = await knownNames(organizationId);
	const targetProjectName = request.projectId
		? (
				await db.query.projects.findFirst({
					where: and(
						eq(projects.projectId, request.projectId),
						eq(projects.organizationId, organizationId),
					),
					columns: { name: true },
				})
			)?.name
		: undefined;
	if (request.projectId && !targetProjectName) throw notFound("Target project not found");
	const normalized = normalizeSourceEnvironment({
		...fetched.normalizedInput,
		knownServers: names.servers,
		knownRegistries: names.registries,
		targetProjectName,
		targetEnvironmentName: request.environmentName,
		keepAppNames: request.keepAppNames,
	});
	const target = await resolveTarget(request, organizationId, normalized);
	return { fetched, normalized, target };
};

export const planImport = async (
	request: ImportRequest,
	organizationId: string,
	options: { includeSensitive?: boolean } = {},
): Promise<ImportPlan> => {
	const { fetched, normalized, target } = await normalizeRequest(request, organizationId);
	let plan: GitopsPlanResult | null = null;
	if (target.projectId && !target.createsEnvironment) {
		const graph = await loadEnvironmentGraph(
			target.projectId,
			target.environmentName,
			organizationId,
		);
		plan = buildPlan(
			normalized.manifest,
			liveStateFromGraph(target.projectId, target.environmentName, graph, options),
		);
	}
	return {
		source: {
			host: fetched.client.host,
			project: fetched.normalizedInput.project.name,
			environment: fetched.normalizedInput.environment.name,
		},
		target,
		manifest: normalized.manifest,
		notes: normalized.notes,
		counts: normalized.counts,
		plan,
	};
};

export interface ImportResult extends ImportPlan {
	target: ImportTarget & { projectId: string };
	result: ApplyStackResult;
	secrets: ApplySecretsResult;
}

/** Create what is missing, apply the manifest, write the values. Deploys nothing. */
export const applyImport = async (
	request: ImportRequest,
	organizationId: string,
	options: { includeSensitive?: boolean } = {},
): Promise<ImportResult> => {
	const { fetched, normalized, target } = await normalizeRequest(request, organizationId);

	let projectId = target.projectId;
	if (!projectId) {
		const [created] = await db
			.insert(projects)
			.values({
				name: target.projectName,
				description: fetched.normalizedInput.project.description ?? null,
				organizationId,
			})
			.returning();
		if (!created) throw badRequest("Could not create the target project");
		projectId = created.projectId;
	}
	if (target.createsEnvironment) {
		await db.insert(environments).values({
			name: target.environmentName,
			description: fetched.normalizedInput.environment.description ?? null,
			projectId,
		});
	}

	const result = await applyStack(normalized.manifest, organizationId, projectId, options);
	const graph = await loadEnvironmentGraph(projectId, target.environmentName, organizationId);
	const secrets = await applySecretsPayload(normalized.secrets, graph);

	return {
		source: {
			host: fetched.client.host,
			project: fetched.normalizedInput.project.name,
			environment: fetched.normalizedInput.environment.name,
		},
		target: { ...target, projectId },
		manifest: normalized.manifest,
		notes: normalized.notes,
		counts: normalized.counts,
		plan: result,
		result,
		secrets,
	};
};
