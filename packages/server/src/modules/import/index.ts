import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, projects, registry, servers } from "../../db/schema";
import { badRequest, conflict, notFound, preconditionFailed } from "../errors";
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
import { findProjectById } from "../projects";
import { currentProjectFilter } from "../projects/project-scope";
import { DATABASE_KINDS, type DatabaseServiceKind } from "../services/registry";
import { SourcePanelClient } from "./client";
import { CoolifySourceReader } from "./coolify-reader";
import type { ImportSource } from "./kinds";

export { IMPORT_SOURCES, type ImportSource } from "./kinds";

import { DumpSourceReader } from "./dump";
import { readDumpMeta } from "./dump-store";
import {
	type ImportNote,
	type NormalizedEnvironment,
	normalizeSourceEnvironment,
} from "./normalize";
import type { SourceReader } from "./reader";
import { importReviewToken, summarizeImportValues } from "./review";
import type {
	SourceApplication,
	SourceCompose,
	SourceDatabase,
	SourceProjectSummary,
} from "./source-schema";

export { SourcePanelClient } from "./client";
export { DumpSourceReader, pruneImportContainers } from "./dump";
export {
	MAX_DUMP_BYTES,
	pruneImportDumps,
	readDumpMeta,
	removeDump,
	type StoredDump,
	sniffDump,
	storeDump,
} from "./dump-store";
export type { ImportNote, NormalizedEnvironment } from "./normalize";
export { normalizeSourceEnvironment } from "./normalize";
export type { SourceReader } from "./reader";

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

export interface ImportSourceOptions {
	source: ImportSource;
	/** Live path: the source panel's origin and a read-capable API key. */
	url?: string;
	apiKey?: string;
	/** Offline path: an uploaded database dump of the source panel (`import.uploadDump`). */
	dumpId?: string;
}

/** Open whichever reader the options name; the caller closes it. */
const openReader = async (
	options: ImportSourceOptions,
	organizationId: string,
): Promise<SourceReader> => {
	if (options.dumpId) {
		if (options.source !== "dokploy")
			throw badRequest(
				"Database dump import currently supports Dokploy only; use the Coolify live API",
			);
		const meta = await readDumpMeta(organizationId, options.dumpId);
		return DumpSourceReader.open(meta);
	}
	if (!options.url || !options.apiKey) {
		throw badRequest("Give the source panel's url and apiKey, or a dumpId of an uploaded dump");
	}
	return options.source === "coolify"
		? CoolifySourceReader.connect({ url: options.url, apiKey: options.apiKey })
		: SourcePanelClient.connect({ url: options.url, apiKey: options.apiKey });
};

export interface ImportRequest extends ImportSourceOptions {
	sourceProjectId: string;
	/** Environment of the source project; its first one when omitted. */
	sourceEnvironmentName?: string;
	/** Target project; created with the source project's name when omitted and absent. */
	projectId?: string;
	/** Target environment name; the source environment's name when omitted. */
	environmentName?: string;
	keepAppNames?: boolean;
	/** Optional kind/source-id inventory selection; omitted imports the whole environment. */
	serviceIds?: string[];
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
			services: Array<{ id: string; name: string; kind: string }>;
		}>;
	}>;
}

/** Source ids are namespaced by kind, since providers may reuse ids across tables. */
const inventoryServices = (environment: SourceProjectSummary["environments"][number]) => [
	...environment.applications.map((row) => ({
		id: `application/${row.applicationId}`,
		name: row.name,
		kind: "application",
	})),
	...environment.compose.map((row) => ({
		id: `compose/${row.composeId}`,
		name: row.name,
		kind: "compose",
	})),
	...DATABASE_KINDS.flatMap((kind) =>
		environment[kind].map((row) => ({
			id: `${kind}/${String((row as Record<string, unknown>)[`${kind}Id`])}`,
			name: row.name,
			kind,
		})),
	),
];

/** What the key can see, counted — nothing that could hold a value. */
export const inspectSource = async (
	options: ImportSourceOptions,
	organizationId: string,
): Promise<SourceInventory> => {
	const client = await openReader(options, organizationId);
	let rows: SourceProjectSummary[];
	try {
		rows = await client.listProjects();
	} finally {
		await client.close();
	}
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
				unsupported: environment.libsql.length + (environment.unsupportedResources?.length ?? 0),
				services: inventoryServices(environment),
			})),
		})),
	};
};

interface FetchedEnvironment {
	client: SourceReader;
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
const fetchSourceEnvironment = async (
	request: ImportRequest,
	organizationId: string,
): Promise<FetchedEnvironment> => {
	const client = await openReader(request, organizationId);
	try {
		return await readSourceEnvironment(client, request);
	} finally {
		await client.close();
	}
};

const readSourceEnvironment = async (
	client: SourceReader,
	request: ImportRequest,
): Promise<FetchedEnvironment> => {
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

	const selected = request.serviceIds ? new Set(request.serviceIds) : null;
	if (selected) {
		const available = new Set(inventoryServices(environment).map((row) => row.id));
		if (selected.size === 0 || [...selected].some((id) => !available.has(id))) {
			throw badRequest(
				"Select at least one service from the current source environment; inspect again if it changed",
			);
		}
	}

	// Sequential on purpose: a panel on a small box answers one `one` at a
	// time comfortably and ten in parallel with 502s.
	const applications: SourceApplication[] = [];
	for (const row of environment.applications) {
		if (selected && !selected.has(`application/${row.applicationId}`)) continue;
		applications.push(await client.getApplication(row.applicationId));
	}
	const compose: SourceCompose[] = [];
	for (const row of environment.compose) {
		if (selected && !selected.has(`compose/${row.composeId}`)) continue;
		compose.push(await client.getCompose(row.composeId));
	}
	const databases = {} as Record<DatabaseServiceKind, SourceDatabase[]>;
	for (const kind of DATABASE_KINDS) {
		databases[kind] = [];
		for (const row of environment[kind]) {
			const id = (row as Record<string, unknown>)[`${kind}Id`];
			if (typeof id !== "string" || (selected && !selected.has(`${kind}/${id}`))) continue;
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

const targetEnvironment = async (projectId: string, name: string) => {
	const rows = await db.query.environments.findMany({
		where: and(eq(environments.projectId, projectId), eq(environments.name, name)),
		limit: 2,
	});
	if (rows.length > 1)
		throw conflict(
			"The target project has multiple environments with this name. Rename the duplicates before importing.",
		);
	return rows[0];
};

/** Resolve where the import lands, without writing anything. */
const resolveTarget = async (
	request: ImportRequest,
	organizationId: string,
	normalized: NormalizedEnvironment,
): Promise<ImportTarget> => {
	const environmentName = normalized.manifest.environment?.name ?? "production";
	if (request.projectId) {
		const project = await findProjectById(request.projectId, organizationId);
		const environment = await targetEnvironment(project.projectId, environmentName);
		return {
			projectId: project.projectId,
			projectName: project.name,
			environmentName,
			createsProject: false,
			createsEnvironment: !environment,
		};
	}
	const projectName = normalized.manifest.project.name;
	const matches = await db.query.projects.findMany({
		where: and(eq(projects.organizationId, organizationId), eq(projects.name, projectName)),
		limit: 2,
	});
	for (const row of matches) await findProjectById(row.projectId, organizationId);
	if (matches.length > 1)
		throw conflict(
			"More than one target project has the source name. Choose an existing target project explicitly.",
		);
	const existing = matches[0];
	if (existing) {
		// A name match is still a project access: do this before returning its
		// id or creating an environment, including when no graph exists yet.
		await findProjectById(existing.projectId, organizationId);
		const environment = await targetEnvironment(existing.projectId, environmentName);
		return {
			projectId: existing.projectId,
			projectName,
			environmentName,
			createsProject: false,
			createsEnvironment: !environment,
		};
	}
	if (currentProjectFilter()?.kind === "projects") {
		throw preconditionFailed(
			"Your project access is restricted. Choose an existing accessible target project before importing.",
		);
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
	source: { provider: ImportSource; host: string; project: string; environment: string };
	target: ImportTarget;
	/** The manifest that would be applied: keys only, no values. */
	manifest: NixployStack;
	notes: ImportNote[];
	counts: NormalizedEnvironment["counts"];
	/** Diff against the target, or null when the target does not exist yet (everything is a create). */
	plan: GitopsPlanResult | null;
	/** Opaque digest binding the review to source values, target and current diff. */
	reviewToken: string;
	valueGroups: ReturnType<typeof summarizeImportValues>;
}

const normalizeRequest = async (
	request: ImportRequest,
	organizationId: string,
): Promise<{
	fetched: FetchedEnvironment;
	normalized: NormalizedEnvironment;
	target: ImportTarget;
}> => {
	const fetched = await fetchSourceEnvironment(request, organizationId);
	const names = await knownNames(organizationId);
	const targetProjectName = request.projectId
		? (await findProjectById(request.projectId, organizationId)).name
		: undefined;
	const normalized = normalizeSourceEnvironment({
		...fetched.normalizedInput,
		knownServers: names.servers,
		knownRegistries: names.registries,
		targetProjectName,
		targetEnvironmentName: request.environmentName,
		keepAppNames: request.source === "coolify" ? false : request.keepAppNames,
	});
	normalized.notes.push(...(fetched.client.getNotes?.() ?? []));
	const target = await resolveTarget(request, organizationId, normalized);
	return { fetched, normalized, target };
};

export const prepareImport = async (
	request: ImportRequest,
	organizationId: string,
	options: { includeSensitive?: boolean } = {},
) => {
	const { fetched, normalized, target } = await normalizeRequest(request, organizationId);
	let plan: GitopsPlanResult | null = null;
	let live: ReturnType<typeof liveStateFromGraph> | null = null;
	let targetValues: unknown = target.projectId
		? { project: (await findProjectById(target.projectId, organizationId)).env }
		: null;
	if (target.projectId && !target.createsEnvironment) {
		const graph = await loadEnvironmentGraph(
			target.projectId,
			target.environmentName,
			organizationId,
		);
		live = liveStateFromGraph(target.projectId, target.environmentName, graph, options);
		// Bind values apply may overwrite too; public plans expose only key names.
		targetValues = {
			project: graph.project.env,
			environment: graph.environment.env,
			applications: graph.services.applications.map((row) => ({
				name: row.name,
				env: row.env,
				buildArgs: row.buildArgs,
				previewEnv: row.previewEnv,
			})),
			compose: graph.services.compose.map((row) => ({
				name: row.name,
				env: row.env,
				buildArgs: row.buildArgs,
				previewEnv: row.previewEnv,
			})),
			databases: Object.fromEntries(
				DATABASE_KINDS.map((kind) => [
					kind,
					graph.services[kind].map((row) => ({ name: row.name, env: row.env })),
				]),
			),
		};
		plan = buildPlan(normalized.manifest, live);
	}
	const reviewToken = importReviewToken({
		organizationId,
		source: {
			provider: request.source,
			url: request.url,
			dumpId: request.dumpId,
			project: request.sourceProjectId,
			environment: request.sourceEnvironmentName,
			keepAppNames: request.keepAppNames ?? false,
			serviceIds: request.serviceIds ? [...request.serviceIds].sort() : undefined,
		},
		normalized,
		target,
		live,
		targetValues,
		plan,
	});
	const review: ImportPlan = {
		reviewToken,
		valueGroups: summarizeImportValues(normalized.secrets),
		source: {
			provider: request.source,
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
	return { fetched, normalized, target, review };
};

export const planImport = async (
	request: ImportRequest,
	organizationId: string,
	options: { includeSensitive?: boolean } = {},
): Promise<ImportPlan> => (await prepareImport(request, organizationId, options)).review;

export interface ImportResult extends ImportPlan {
	target: ImportTarget & { projectId: string };
	result: ApplyStackResult;
	secrets: ApplySecretsResult;
	resources: Array<{ id: string; name: string; kind: string }>;
}

/** Create what is missing, apply the manifest, write the values. Deploys nothing. */
export const applyPreparedImport = async (
	prepared: Awaited<ReturnType<typeof prepareImport>>,
	organizationId: string,
	options: { includeSensitive?: boolean; reviewToken?: string } = {},
): Promise<ImportResult> => {
	const { fetched, normalized, target, review } = prepared;
	if (options.reviewToken && options.reviewToken !== review.reviewToken) {
		throw conflict(
			"The source or target changed after review. Generate a fresh plan before importing.",
		);
	}

	const projectId = await db.transaction(async (tx) => {
		let id = target.projectId;
		if (!id) {
			const [created] = await tx
				.insert(projects)
				.values({
					name: target.projectName,
					description: fetched.normalizedInput.project.description ?? null,
					organizationId,
				})
				.returning();
			if (!created) throw badRequest("Could not create the target project");
			id = created.projectId;
		}
		if (target.createsEnvironment) {
			await tx.insert(environments).values({
				name: target.environmentName,
				description: fetched.normalizedInput.environment.description ?? null,
				projectId: id,
			});
		}
		return id;
	});

	const result = await applyStack(normalized.manifest, organizationId, projectId, {
		...options,
		syncRuntime: false,
	});
	const graph = await loadEnvironmentGraph(projectId, target.environmentName, organizationId);
	const secrets = await applySecretsPayload(normalized.secrets, graph);

	return {
		reviewToken: review.reviewToken,
		valueGroups: review.valueGroups,
		source: {
			provider: review.source.provider,
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
		resources: [
			...graph.services.applications
				.filter((row) => normalized.manifest.applications?.some((entry) => entry.name === row.name))
				.map((row) => ({ id: row.applicationId, name: row.name, kind: "application" })),
			...graph.services.compose
				.filter((row) => normalized.manifest.compose?.some((entry) => entry.name === row.name))
				.map((row) => ({ id: row.composeId, name: row.name, kind: "compose" })),
			...DATABASE_KINDS.flatMap((kind) =>
				graph.services[kind]
					.filter((row) =>
						normalized.manifest.databases?.[kind]?.some((entry) => entry.name === row.name),
					)
					.map((row) => ({
						id: String((row as Record<string, unknown>)[`${kind}Id`]),
						name: row.name,
						kind,
					})),
			),
		],
	};
};

/** Programmatic/CLI compatibility; routers reuse the exact prepared input checked for permissions. */
export const applyImport = async (
	request: ImportRequest,
	organizationId: string,
	options: { includeSensitive?: boolean; reviewToken?: string } = {},
): Promise<ImportResult> =>
	applyPreparedImport(
		await prepareImport(request, organizationId, options),
		organizationId,
		options,
	);
