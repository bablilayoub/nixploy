import { mkdir, rm } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
	compose,
	deployments,
	domains,
	environments,
	mounts,
	previewDeployments,
	redirects,
	security,
} from "../../db/schema";
import { bestEffort } from "../../utils/best-effort";
import { assertSafeAppName } from "../../utils/validators";
import { getSwarmNetwork } from "../application/paths";
import { materializeFileMount } from "../application/service";
import { unregisterBackupsForService } from "../backups/scheduler";
import { getServerSwarmNodeId } from "../cluster/swarm-node";
import type { DeploymentContext } from "../deployment/context";
import { removeServiceLogs } from "../deployment/maintenance";
import { ensureEnvironmentNetworkById, pruneEnvironmentNetwork } from "../deployment/network";
import { badRequest, conflict, notFound, preconditionFailed } from "../errors";
import { assertProjectVisible } from "../projects/project-scope";
import { removeRuntimeLogs } from "../runtime-logs/store";
import { unregisterSchedulesForService } from "../schedules";
import { generateAppName, isAppNameTaken, randomAppNameSuffix } from "../services/app-name";
import { toTraefikDomainEntry } from "../traefik/config-writer";
import { getTraefik } from "./adapters";
import { collectComposeBuildTargets } from "./build";
import { buildComposeImages } from "./build-runner";
import {
	buildComposeDeployCommand,
	buildComposeDownCommand,
	buildComposeFallbackDownCommand,
	buildComposeStopCommand,
	composeSuffix,
	deployedServiceName,
	sharedNetworkConnectCommand,
	sharedNetworkServiceUpdateCommand,
	stackServiceName,
	traefikAppName,
} from "./commands";
import {
	assertSafeComposeSpec,
	buildDeployComposeFile,
	type ComposeSafetyOptions,
	composeEnvMap,
	hostPrivilegedComposeSafety,
	listComposeServices,
	mergeEnvVars,
	parseComposeFile,
	shouldRedactEnvValue,
} from "./compose-file";
import { invalidateComposeContainers, listComposeContainers } from "./containers";
import { loadComposeMounts, toComposeMounts } from "./mount-rows";
import {
	getComposeBaseDir,
	getComposeDeployFilePath,
	getComposeEnvPath,
	resolveComposeFilePath,
	shellQuote,
} from "./paths";
import { recordComposeSnapshot, resolveCurrentDeploymentId } from "./snapshot";
import {
	type ComposeRow,
	cloneComposeSource,
	readComposeFile,
	runComposeCommand,
	writeComposeFile,
} from "./source";

export type { ComposeRow };
export { buildComposeDeployCommand, traefikAppName };

/**
 * Stack rows are Swarm services: their deploy/rm/inspect commands run on the
 * primary manager whatever server the row is pinned to (see
 * `runComposeCommand`). Plain compose rows run entirely on their server.
 */
export const runsOnPrimary = (row: Pick<ComposeRow, "composeType">): boolean =>
	row.composeType === "stack";

/** Compose row with its tenancy chain (environment → project) loaded. */
export async function findComposeById(composeId: string) {
	return db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
		with: {
			environment: { with: { project: true } },
			// Only the base URLs: the provider rows also carry access tokens and
			// this row is what `compose.one` returns to the browser.
			gitlab: { columns: { gitlabUrl: true } },
			gitea: { columns: { giteaUrl: true } },
		},
	});
}

/** Throw NOT_FOUND unless the compose exists and belongs to the organization. */
export async function findComposeForOrg(
	composeId: string,
	organizationId: string | null | undefined,
) {
	const row = await findComposeById(composeId);
	if (!row || row.environment.project.organizationId !== organizationId) {
		throw notFound("Compose service not found");
	}
	assertProjectVisible(row.environment.projectId, "Compose service");
	return row;
}

/**
 * appName is shared across every swarm namespace (applications, compose stacks
 * and their `<app>-<service>` Traefik keys, databases, previews), so the
 * generator is the shared one in `modules/services/app-name.ts` — only the
 * fallback for an all-punctuation name differs.
 */
const generateUniqueAppName = (name: string): Promise<string> => generateAppName(name, "compose");

export interface CreateComposeInput {
	name: string;
	description?: string | null;
	environmentId: string;
	composeType: "docker-compose" | "stack";
	sourceType: "raw" | "git" | "github" | "gitlab" | "bitbucket" | "gitea";
	appName?: string;
	serverId?: string | null;
	/** Instance-admin privileged templates only — never expose on public create APIs. */
	hostPrivileged?: boolean;
}

export async function createCompose(input: CreateComposeInput): Promise<ComposeRow> {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, input.environmentId),
		with: { project: true },
	});
	if (!environment) {
		throw notFound("Environment not found");
	}
	const appName = input.appName
		? (() => {
				try {
					return assertSafeAppName(input.appName);
				} catch (error) {
					throw badRequest(error instanceof Error ? error.message : "Invalid appName");
				}
			})()
		: await generateUniqueAppName(input.name);
	if (await isAppNameTaken(appName)) {
		throw conflict(`appName "${appName}" is already in use`);
	}
	const [created] = await db
		.insert(compose)
		.values({
			name: input.name,
			description: input.description ?? null,
			environmentId: input.environmentId,
			composeType: input.composeType,
			sourceType: input.sourceType,
			appName,
			serverId: input.serverId ?? null,
			hostPrivileged: input.hostPrivileged ?? false,
		})
		.returning();
	if (!created) throw new Error("Failed to create compose service");
	return created;
}

/**
 * Clone a compose service into `environmentId` with a fresh appName and
 * status `idle`: compose file, env, source and mounts. Domains and
 * deployments are NOT copied.
 */
export async function duplicateCompose(
	source: ComposeRow,
	environmentId: string,
): Promise<ComposeRow> {
	const appName = await generateUniqueAppName(source.name);
	const {
		composeId: sourceId,
		createdAt: _createdAt,
		status: _status,
		appName: _appName,
		...rest
	} = source;
	const [created] = await db
		.insert(compose)
		.values({
			...rest,
			appName,
			environmentId,
			status: "idle",
			hostPrivileged: false,
		})
		.returning();
	if (!created) throw new Error("Failed to duplicate compose service");

	const sourceMounts = await db.query.mounts.findMany({
		where: eq(mounts.composeId, sourceId),
	});
	if (sourceMounts.length > 0) {
		await db.insert(mounts).values(
			sourceMounts.map((mount) => ({
				type: mount.type,
				hostPath: mount.hostPath,
				volumeName: mount.volumeName,
				filePath: mount.filePath,
				content: mount.content,
				mountPath: mount.mountPath,
				serviceType: "compose" as const,
				composeId: created.composeId,
			})),
		);
	}

	return created;
}

/**
 * Whether the row has ever been deployed: a deployment row exists, or
 * containers of the project / stack are present on its server (best effort).
 */
async function hasBeenDeployed(row: ComposeRow): Promise<boolean> {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.composeId, row.composeId),
		columns: { deploymentId: true },
	});
	if (deployment) return true;
	// This decides whether the row has EVER run, so it must not be answered from
	// the 10 s listing cache a concurrent runtime-tab poll may have just filled.
	invalidateComposeContainers(row.appName, row.serverId);
	const containers = await listComposeContainers(row.appName, row.serverId).catch(() => []);
	return containers.length > 0;
}

/**
 * Columns that decide WHAT is rendered on the next deploy. `hostPrivileged`
 * relaxes the compose safety check (docker.sock, extra capabilities) for
 * templates an instance admin installed; it must never survive a re-pointed
 * source, or a `service.write` holder could deploy their own repo with the
 * host socket allowed. Changing any of these as a non-admin drops the flag.
 */
export const COMPOSE_SOURCE_FIELDS = [
	"sourceType",
	"repository",
	"owner",
	"branch",
	"composePath",
	"gitUrl",
	"gitBranch",
	"customGitSSHKeyId",
	"githubId",
	"gitlabId",
	"bitbucketId",
	"giteaId",
] as const satisfies readonly (keyof ComposeRow)[];

export type ComposeUpdateInput = Partial<
	Omit<typeof compose.$inferInsert, "composeId" | "environmentId" | "createdAt" | "hostPrivileged">
>;

export interface ComposeMutationOptions {
	/**
	 * The caller passed `assertInstanceAdmin` for this row. Only then does a
	 * host-privileged row keep its flag (and its relaxed safety check) across
	 * a source or compose-file change. Defaults to false: every other path
	 * (GitOps apply, future callers) demotes the row to the strict check.
	 */
	callerIsInstanceAdmin?: boolean;
}

/** True when `input` changes at least one of {@link COMPOSE_SOURCE_FIELDS}. */
export function composeSourceChanged(
	existing: Pick<ComposeRow, (typeof COMPOSE_SOURCE_FIELDS)[number]>,
	input: ComposeUpdateInput,
): boolean {
	return COMPOSE_SOURCE_FIELDS.some(
		(field) => input[field] !== undefined && input[field] !== existing[field],
	);
}

export async function updateComposeById(
	composeId: string,
	input: ComposeUpdateInput,
	options: ComposeMutationOptions = {},
): Promise<ComposeRow> {
	const existing = await db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
	});
	if (!existing) throw notFound("Compose service not found");

	const values: Partial<typeof compose.$inferInsert> = { ...input };
	if (values.appName && values.appName !== existing.appName) {
		if (await isAppNameTaken(values.appName)) {
			throw conflict(`appName "${values.appName}" is already in use`);
		}
		// The appName names the running project/stack, its volumes and the
		// Traefik configs — renaming would orphan all of them.
		if (await hasBeenDeployed(existing)) {
			throw preconditionFailed(
				"appName cannot be changed after the first deployment (it names the running stack, its volumes and routing). Create a new service instead.",
			);
		}
	}
	// Isolated deployments need a suffix; the UI only sends the toggle.
	if (
		(values.isolatedDeployment ?? existing.isolatedDeployment) &&
		!(values.suffix || existing.suffix)
	) {
		values.suffix = randomAppNameSuffix();
	}
	if (
		existing.hostPrivileged &&
		!options.callerIsInstanceAdmin &&
		composeSourceChanged(existing, input)
	) {
		values.hostPrivileged = false;
	}

	const [updated] = await db
		.update(compose)
		.set(values)
		.where(eq(compose.composeId, composeId))
		.returning();
	if (!updated) throw notFound("Compose service not found");
	return updated;
}

// ── file preparation ────────────────────────────────────────────────────────

export interface PreparedComposeFiles {
	/** Directory compose commands run in (`<configDir>/compose/<appName>`). */
	workDir: string;
	/** Rendered compose file passed with `-f` / `-c` (`docker-compose.nixploy.yml`). */
	composeFilePath: string;
	/** Merged env written for operators; the deploy commands do not read it. */
	envFilePath: string;
	/** Git tokens / passwords to scrub from logs and errorMessage. */
	secrets: string[];
}

/**
 * Source service names that have a Nixploy domain (the Traefik targets).
 * Preview domains are excluded: they carry the same `composeId` (so the
 * Domains tab and the org check keep working) but belong to a `<app>-pr-<n>`
 * project, and their hosts must never end up in production's routing.
 */
async function exposedServiceNames(composeId: string): Promise<Set<string>> {
	const rows = await db.query.domains.findMany({
		where: and(eq(domains.composeId, composeId), isNull(domains.previewDeploymentId)),
		columns: { serviceName: true },
	});
	const names = new Set<string>();
	for (const row of rows) if (row.serviceName) names.add(row.serviceName);
	return names;
}

export interface PrepareComposeFilesOptions {
	/**
	 * Deployment this render belongs to. When it resolves (explicitly, or via
	 * the currently-claimed job — see `snapshot.ts#resolveCurrentDeploymentId`)
	 * the rendered file + env are snapshotted so `compose.rollback` can restore
	 * them. Pass `null` to skip the snapshot entirely.
	 */
	deploymentId?: string | null;
	/**
	 * Deploy context for stacks that build from source. When the row has
	 * `buildEnabled` and the file declares `build:` services, their images are
	 * built here (before the render) and the rendered file points at them.
	 * Absent on the paths that only re-render an already-deployed stack
	 * (start/stop/domain resync), which must never trigger a build.
	 */
	build?: {
		ctx: DeploymentContext;
		deploymentId: string;
		/** Called before each service builds, so a cancel lands between builds. */
		onBeforeService?: (serviceName: string) => Promise<void> | void;
	};
}

/**
 * Materialize everything a deploy needs on disk: clone the git source when
 * applicable, render the compose file (env interpolated, safety-checked,
 * suffix + networks injected) to `docker-compose.nixploy.yml`, and write the
 * merged project → environment → service env file.
 * Also used by the deploy engine's worker for compose jobs.
 *
 * When this render belongs to a deployment it also records a rollback
 * snapshot (see `snapshot.ts`) — best effort, never a deploy blocker.
 */
export async function prepareComposeFiles(
	composeRow: ComposeRow,
	options: PrepareComposeFilesOptions = {},
): Promise<PreparedComposeFiles> {
	const { appName } = composeRow;
	const envFilePath = getComposeEnvPath(appName);
	const composeFilePath = getComposeDeployFilePath(appName);
	let rawContent: string;
	let secrets: string[] = [];

	if (composeRow.sourceType === "raw") {
		rawContent = composeRow.composeFile;
		if (!rawContent.trim()) {
			throw preconditionFailed("Compose file is empty — save a compose file before deploying");
		}
		// Keep the untouched source next to the rendered file for operators.
		await writeComposeFile(
			composeRow,
			resolveComposeFilePath(appName, "raw", composeRow.composePath),
			rawContent,
		);
	} else {
		const cloned = await cloneComposeSource(composeRow);
		secrets = cloned.secrets;
		rawContent = await readComposeFile(
			composeRow,
			resolveComposeFilePath(appName, composeRow.sourceType, composeRow.composePath),
		);
	}

	// Env inheritance: project → environment → service (service wins).
	const full = await findComposeById(composeRow.composeId);
	const mergedEnv = mergeEnvVars(
		full?.environment.project.env,
		full?.environment.env,
		composeRow.env,
	);
	const env = composeEnvMap(mergedEnv);

	// Stack rows pinned to a server: `docker stack deploy` runs on the primary
	// manager, so the rendered file is written on the Nixploy host and every
	// service is placed on the server's swarm node. The clone/raw source and
	// the operator `.env` stay on the row's server as before.
	const onPrimary = runsOnPrimary(composeRow);
	const swarmNodeId =
		onPrimary && composeRow.serverId ? await getServerSwarmNodeId(composeRow.serverId) : null;

	// Declared `external: true` in the rendered file, so it has to exist before
	// the compose/stack command runs.
	const environmentNetwork = await ensureEnvironmentNetworkById(composeRow.environmentId);

	const safety: ComposeSafetyOptions = {
		...(composeRow.hostPrivileged ? hostPrivilegedComposeSafety() : {}),
		allowBuild: composeRow.buildEnabled,
		allowPorts: composeRow.publishPorts,
	};

	// Build first, render second: the rendered file must not contain `build:`
	// at all, so docker never resolves a context itself. Only a real deploy
	// passes `options.build`; every other render reuses whatever images the
	// last deploy produced (they are tagged per deployment and kept).
	let builtImages: ReadonlyMap<string, string> = new Map();
	if (composeRow.buildEnabled && options.build) {
		const targets = collectComposeBuildTargets(parseComposeFile(rawContent));
		builtImages = await buildComposeImages(
			options.build.ctx,
			composeRow,
			targets,
			options.build.deploymentId,
			options.build.onBeforeService,
		);
	}

	// Mount rows of the stack. `file` mounts are written to the target host
	// first — the deploy engine only resolves the bind source, it never
	// creates it — exactly as the application path does.
	const mountRows = await loadComposeMounts(composeRow.composeId);
	for (const mount of mountRows) {
		if (mount.type === "file" && mount.filePath) {
			await materializeFileMount(appName, mount.filePath, mount.content ?? "", composeRow.serverId);
		}
	}

	const transformed = buildDeployComposeFile(
		rawContent,
		{
			appName,
			composeType: composeRow.composeType,
			suffix: composeSuffix(composeRow),
			env,
			exposedServices: await exposedServiceNames(composeRow.composeId),
			environmentNetwork,
			swarmNodeId,
			builtImages,
			mounts: toComposeMounts(appName, mountRows),
		},
		safety,
	);
	// Both carry resolved secrets — owner-only.
	await writeComposeFile(composeRow, composeFilePath, transformed, {
		mode: 0o600,
		onPrimary,
	});
	await writeComposeFile(composeRow, envFilePath, `${mergedEnv}\n`, {
		mode: 0o600,
	});

	// Scrub the merged env from logs — values land in the rendered file and
	// Docker echoes parts of it on errors. Short tokens would redact too much.
	for (const value of Object.values(env)) {
		if (shouldRedactEnvValue(value)) secrets.push(value);
	}

	// Rollback snapshot: exactly what this deployment deploys. `undefined`
	// means "figure it out" (the worker does not pass one yet), `null` means
	// "this render is not a deployment" (start/stop/delete).
	const deploymentId =
		options.deploymentId === undefined
			? await resolveCurrentDeploymentId(composeRow.composeId)
			: options.deploymentId;
	if (deploymentId) {
		await recordComposeSnapshot({
			composeId: composeRow.composeId,
			deploymentId,
			sourceFile: rawContent,
			renderedFile: transformed,
			serviceEnv: composeRow.env ?? null,
			mergedEnv,
		});
	}

	return {
		workDir: getComposeBaseDir(appName),
		composeFilePath,
		envFilePath,
		secrets,
	};
}

// ── lifecycle commands ──────────────────────────────────────────────────────

/** The deploy command shown in the UI ("getDefaultCommand"). */
export function getDefaultCommand(row: ComposeRow): string {
	return buildComposeDeployCommand(row, {
		composeFilePath: getComposeDeployFilePath(row.appName),
	});
}

async function updateStatus(composeId: string, status: "idle" | "running" | "done" | "error") {
	await db.update(compose).set({ status }).where(eq(compose.composeId, composeId));
}

/** `docker compose up -d` / `docker stack deploy` for an already-prepared row. */
export async function startCompose(composeRow: ComposeRow): Promise<void> {
	await updateStatus(composeRow.composeId, "running");
	try {
		// Not a deployment: never snapshot, never displace the worker's own row.
		const files = await prepareComposeFiles(composeRow, { deploymentId: null });
		await runComposeCommand(composeRow, buildComposeDeployCommand(composeRow, files), {
			cwd: files.workDir,
			onPrimary: runsOnPrimary(composeRow),
		});
		await updateStatus(composeRow.composeId, "running");
	} catch (error) {
		await updateStatus(composeRow.composeId, "error");
		throw error;
	} finally {
		// Every container of the project was just replaced (or failed to come
		// up): drop the 10 s listing cache so the runtime tab does not keep
		// rendering the previous container ids.
		invalidateComposeContainers(composeRow.appName, composeRow.serverId);
	}
}

/** Stop without removing: `docker compose stop`, or `docker stack rm` for stacks. */
export async function stopCompose(composeRow: ComposeRow): Promise<void> {
	try {
		// Not a deployment: never snapshot, never displace the worker's own row.
		const files = await prepareComposeFiles(composeRow, { deploymentId: null });
		await runComposeCommand(composeRow, buildComposeStopCommand(composeRow, files), {
			cwd: files.workDir,
			onPrimary: runsOnPrimary(composeRow),
		});
	} finally {
		await updateStatus(composeRow.composeId, "idle");
		invalidateComposeContainers(composeRow.appName, composeRow.serverId);
	}
}

/**
 * Tear down the deployment, remove its Traefik configs and delete the row
 * (domains cascade). Docker failures are tolerated so a broken deployment
 * never blocks deletion.
 */
export async function deleteCompose(composeRow: ComposeRow): Promise<void> {
	// Stop cron work that targets this stack before its containers go away;
	// the rows cascade with the compose row, the in-memory jobs do not.
	unregisterSchedulesForService({
		composeId: composeRow.composeId,
		appName: composeRow.appName,
	});
	unregisterBackupsForService({
		appName: composeRow.appName,
		composeId: composeRow.composeId,
	});

	// PR previews are separate projects with their own Traefik files: the rows
	// cascade with this one, the running stacks and the YAML do not. Imported
	// lazily — `modules/preview` reaches the deploy engine, which reaches back
	// here through the worker.
	const previews = await db.query.previewDeployments.findMany({
		where: eq(previewDeployments.composeId, composeRow.composeId),
	});
	if (previews.length > 0) {
		const { deletePreviewDeployment } = await import("../preview");
		await Promise.all(
			previews.map((preview) =>
				bestEffort(`remove preview deployment ${preview.appName}`, () =>
					deletePreviewDeployment(preview.previewDeploymentId),
				),
			),
		);
	}

	const composeDomains = await db.query.domains.findMany({
		where: eq(domains.composeId, composeRow.composeId),
	});

	try {
		// When the files cannot be prepared (clone failure, file now failing
		// safety, empty file) fall back to the name-only teardown so the
		// containers never outlive the row.
		const files = await prepareComposeFiles(composeRow, { deploymentId: null }).catch(() => null);
		const command = files
			? buildComposeDownCommand(composeRow, files)
			: buildComposeFallbackDownCommand(composeRow);
		await bestEffort(`bring down stack ${composeRow.appName}`, () =>
			runComposeCommand(composeRow, command, {
				...(files ? { cwd: files.workDir } : {}),
				onPrimary: runsOnPrimary(composeRow),
			}),
		);
	} catch {
		// best-effort teardown
	}
	invalidateComposeContainers(composeRow.appName, composeRow.serverId);

	const traefik = await getTraefik();
	if (traefik) {
		const serviceKeys = new Set<string>();
		for (const d of composeDomains) {
			serviceKeys.add(traefikAppName(composeRow, d.serviceName));
		}
		for (const key of serviceKeys) {
			await bestEffort(`remove Traefik config ${key}`, () =>
				traefik.removeTraefikConfig(key, composeRow.serverId),
			);
		}
		await bestEffort(`remove Traefik config ${composeRow.appName}`, () =>
			traefik.removeTraefikConfig(composeRow.appName, composeRow.serverId),
		);
	}

	await db.delete(compose).where(eq(compose.composeId, composeRow.composeId));
	const baseDir = getComposeBaseDir(composeRow.appName);
	if (composeRow.serverId) {
		await bestEffort(`remove remote files for ${composeRow.appName}`, () =>
			runComposeCommand(composeRow, `rm -rf ${shellQuote(baseDir)}`),
		);
	}
	// Always sweep the Nixploy host too: a stack pinned to a server keeps its
	// rendered file here (no-op for rows that never wrote anything locally).
	await rm(baseDir, { recursive: true, force: true }).catch(() => {});
	// Build logs live outside the compose dir and have no FK to cascade through.
	await bestEffort(`remove logs for ${composeRow.appName}`, () =>
		removeServiceLogs(composeRow.appName),
	);
	await bestEffort(`remove runtime logs for ${composeRow.appName}`, () =>
		removeRuntimeLogs(composeRow.appName),
	);
	// `network rm` refuses an overlay that still has endpoints, so this only
	// lands when this was the last service of the environment.
	await pruneEnvironmentNetwork(composeRow.environmentId);
}

// ── services / domains ──────────────────────────────────────────────────────

/**
 * Service names defined by the compose file. Raw sources parse the stored
 * `composeFile`; git sources clone (reusing the existing clone when present).
 */
export async function loadServices(composeRow: ComposeRow): Promise<string[]> {
	if (composeRow.sourceType === "raw") {
		if (!composeRow.composeFile.trim()) return [];
		return listComposeServices(composeRow.composeFile);
	}
	const composeFilePath = resolveComposeFilePath(
		composeRow.appName,
		composeRow.sourceType,
		composeRow.composePath,
	);
	try {
		const content = await readComposeFile(composeRow, composeFilePath);
		return listComposeServices(content);
	} catch {
		await cloneComposeSource(composeRow);
		const content = await readComposeFile(composeRow, composeFilePath);
		return listComposeServices(content);
	}
}

/**
 * Make sure a running service is reachable by Traefik: a domain added after
 * the deploy targets a service that only joined the private per-app network.
 * Attach it to the shared overlay with its alias, at runtime and idempotently;
 * the next deploy renders the file with the network already included.
 */
async function ensureSharedNetworkAttached(row: ComposeRow, serviceName: string): Promise<void> {
	const network = getSwarmNetwork();
	if (row.composeType === "stack") {
		// Service-level: the primary manager owns the service object.
		const onPrimary = true;
		const [networkId, attached] = await Promise.all([
			runComposeCommand(row, `docker network inspect --format '{{.Id}}' ${shellQuote(network)}`, {
				onPrimary,
			}),
			runComposeCommand(
				row,
				`docker service inspect --format '{{json .Spec.TaskTemplate.Networks}}' ${shellQuote(stackServiceName(row, serviceName))}`,
				{ onPrimary },
			),
		]);
		const targets = (JSON.parse(attached.trim() || "[]") as Array<{ Target?: string }>).map(
			(entry) => entry.Target,
		);
		if (targets.includes(networkId.trim())) return;
		await runComposeCommand(row, sharedNetworkServiceUpdateCommand(row, serviceName), {
			onPrimary,
		});
		return;
	}

	const containerIds = (
		await runComposeCommand(
			row,
			`docker ps -q --filter label=com.docker.compose.project=${shellQuote(row.appName)} --filter label=com.docker.compose.service=${shellQuote(deployedServiceName(row, serviceName))}`,
		)
	)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	for (const containerId of containerIds) {
		const raw = await runComposeCommand(
			row,
			`docker inspect --format '{{json .NetworkSettings.Networks}}' ${shellQuote(containerId)}`,
		);
		const attached = JSON.parse(raw.trim() || "{}") as Record<string, unknown>;
		if (network in attached) continue;
		await runComposeCommand(row, sharedNetworkConnectCommand(row, serviceName, containerId));
	}
}

/**
 * Rewrite Traefik file-provider configs for every compose domain, grouped by
 * target service. The locked Traefik contract has no per-domain serviceName
 * field, so each service gets its own config keyed by {@link traefikAppName};
 * services that lost all their domains have their config removed.
 */
export async function resyncComposeDomains(composeId: string): Promise<void> {
	const traefik = await getTraefik();
	if (!traefik) return;
	const row = await db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
	});
	if (!row) return;

	// Domains carry their own middleware rows; redirects and basic-auth are
	// per compose SERVICE (each service gets its own Traefik config file), so
	// both are loaded once and filtered per group below.
	const [composeDomains, composeRedirects, composeSecurity] = await Promise.all([
		db.query.domains.findMany({
			// Preview domains belong to the `<app>-pr-<n>` project and are written
			// by `modules/preview/traefik.ts` under their own keys.
			where: and(eq(domains.composeId, composeId), isNull(domains.previewDeploymentId)),
			with: { middlewares: true },
		}),
		db.query.redirects.findMany({ where: eq(redirects.composeId, composeId) }),
		db.query.security.findMany({ where: eq(security.composeId, composeId) }),
	]);

	const byService = new Map<string, typeof composeDomains>();
	for (const d of composeDomains) {
		if (!d.serviceName) continue;
		const list = byService.get(d.serviceName) ?? [];
		list.push(d);
		byService.set(d.serviceName, list);
	}

	for (const [serviceName, serviceDomains] of byService) {
		await traefik.writeAppTraefikConfig({
			appName: traefikAppName(row, serviceName),
			serverId: row.serverId,
			// `serviceName` is cleared on purpose: the writer's compose form
			// appends `-<serviceName>-1` to the config key, and the key already
			// IS `<appName>-<service>` / `<appName>_<service>` — which is exactly
			// the network alias `injectNetwork` gives the container (and the swarm
			// DNS name in stack mode). Leaving it set produced
			// `http://<app>-<svc>-<svc>-1`, which resolves nowhere (verified:
			// NXDOMAIN from the Traefik container), so every compose domain 502'd.
			domains: serviceDomains.map((domain) => ({
				...toTraefikDomainEntry(domain),
				serviceName: null,
			})),
			redirects: composeRedirects
				.filter((redirect) => redirect.serviceName === serviceName)
				.map((redirect) => ({
					regex: redirect.regex,
					replacement: redirect.replacement,
					permanent: redirect.permanent,
				})),
			basicAuth: composeSecurity
				.filter((entry) => entry.serviceName === serviceName)
				.map((entry) => ({
					username: entry.username,
					// bcrypt hash (decrypted by the column); Traefik users-file format.
					password: entry.password,
				})),
		});
		// Best effort: the service may simply not be running yet.
		await bestEffort(`attach ${row.appName}/${serviceName} to the shared network`, () =>
			ensureSharedNetworkAttached(row, serviceName),
		);
	}

	// Remove configs for services that no longer have any domain.
	try {
		const services = await loadServices(row);
		for (const serviceName of services) {
			if (!byService.has(serviceName)) {
				await bestEffort(`remove Traefik config ${traefikAppName(row, serviceName)}`, () =>
					traefik.removeTraefikConfig(traefikAppName(row, serviceName), row.serverId),
				);
			}
		}
	} catch {
		// compose file unavailable (never deployed / unpulled source) — skip cleanup
	}
}

/** Persist the `.env` content (service-level env, encrypted at rest). */
export async function saveEnvironment(composeId: string, env: string): Promise<void> {
	await db.update(compose).set({ env }).where(eq(compose.composeId, composeId));
}

/**
 * Save the compose file of a raw source (the `composeFile` column). Git
 * sources are read from the checkout, which is reset on every deploy — edits
 * made here would be silently discarded, so they are rejected.
 *
 * A host-privileged row keeps its relaxed safety check only when the caller
 * is the instance admin (`options.callerIsInstanceAdmin`); anyone else gets
 * the strict check and the row is demoted to `hostPrivileged: false`.
 */
export async function saveComposeFile(
	composeRow: ComposeRow,
	composeFile: string,
	options: ComposeMutationOptions = {},
): Promise<void> {
	if (composeRow.sourceType !== "raw") {
		throw badRequest(
			"The compose file of a git-backed service is edited in the repository (the checkout is reset on every deploy). Switch the source type to raw to edit it here.",
		);
	}
	const keepPrivileged = composeRow.hostPrivileged && options.callerIsInstanceAdmin === true;
	// validate before persisting so a broken / unsafe file is rejected early
	listComposeServices(composeFile);
	// Same options the deploy-time render uses, so a file that would deploy is
	// not refused at save (and one that would be refused is caught here first).
	assertSafeComposeSpec(parseComposeFile(composeFile), {
		...(keepPrivileged ? hostPrivilegedComposeSafety() : {}),
		allowBuild: composeRow.buildEnabled,
		allowPorts: composeRow.publishPorts,
	});
	await db
		.update(compose)
		.set({
			composeFile,
			...(composeRow.hostPrivileged && !keepPrivileged ? { hostPrivileged: false } : {}),
		})
		.where(eq(compose.composeId, composeRow.composeId));
}

/** Ensure the base working directory exists (used by the fallback worker). */
export async function ensureComposeDirs(appName: string): Promise<void> {
	await mkdir(getComposeBaseDir(appName), { recursive: true });
}
