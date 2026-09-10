import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, domains, environments, mounts } from "../../db/schema";
import { assertSafeAppName } from "../../utils/validators";
import { getSwarmNetwork } from "../application/paths";
import { removeServiceLogs } from "../deployment/maintenance";
import { getTraefik } from "./adapters";
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
	composeEnvMap,
	hostPrivilegedComposeSafety,
	listComposeServices,
	mergeEnvVars,
	parseComposeFile,
	shouldRedactEnvValue,
} from "./compose-file";
import { listComposeContainers } from "./containers";
import {
	getComposeBaseDir,
	getComposeDeployFilePath,
	getComposeEnvPath,
	resolveComposeFilePath,
	shellQuote,
} from "./paths";
import {
	type ComposeRow,
	cloneComposeSource,
	readComposeFile,
	runComposeCommand,
	writeComposeFile,
} from "./source";

export type { ComposeRow };
export { buildComposeDeployCommand, traefikAppName };

/** Compose row with its tenancy chain (environment → project) loaded. */
export async function findComposeById(composeId: string) {
	return db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
		with: { environment: { with: { project: true } } },
	});
}

/** Throw NOT_FOUND unless the compose exists and belongs to the organization. */
export async function findComposeForOrg(
	composeId: string,
	organizationId: string | null | undefined,
) {
	const row = await findComposeById(composeId);
	if (!row || row.environment.project.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	}
	return row;
}

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40) || "compose";

export const randomSuffix = () => randomBytes(3).toString("hex");

/** appName is shared across compose + application swarm namespaces. */
export async function isAppNameTaken(appName: string): Promise<boolean> {
	const [c, a] = await Promise.all([
		db.query.compose.findFirst({ where: eq(compose.appName, appName) }),
		db.query.applications.findFirst({ where: eq(applications.appName, appName) }),
	]);
	return Boolean(c || a);
}

export async function generateUniqueAppName(name: string): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = `${slugify(name)}-${randomSuffix()}`;
		if (!(await isAppNameTaken(candidate))) return candidate;
	}
	throw new TRPCError({ code: "CONFLICT", message: "Could not allocate a unique appName" });
}

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
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
	}
	const appName = input.appName
		? (() => {
				try {
					return assertSafeAppName(input.appName);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: error instanceof Error ? error.message : "Invalid appName",
					});
				}
			})()
		: await generateUniqueAppName(input.name);
	if (await isAppNameTaken(appName)) {
		throw new TRPCError({ code: "CONFLICT", message: `appName "${appName}" is already in use` });
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
	if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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
		.values({ ...rest, appName, environmentId, status: "idle", hostPrivileged: false })
		.returning();
	if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
	const containers = await listComposeContainers(row.appName, row.serverId).catch(() => []);
	return containers.length > 0;
}

export async function updateComposeById(
	composeId: string,
	input: Partial<
		Omit<
			typeof compose.$inferInsert,
			"composeId" | "environmentId" | "createdAt" | "hostPrivileged"
		>
	>,
): Promise<ComposeRow> {
	const existing = await db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
	});
	if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });

	const values = { ...input };
	if (values.appName && values.appName !== existing.appName) {
		if (await isAppNameTaken(values.appName)) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `appName "${values.appName}" is already in use`,
			});
		}
		// The appName names the running project/stack, its volumes and the
		// Traefik configs — renaming would orphan all of them.
		if (await hasBeenDeployed(existing)) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"appName cannot be changed after the first deployment (it names the running stack, its volumes and routing). Create a new service instead.",
			});
		}
	}
	// Isolated deployments need a suffix; the UI only sends the toggle.
	if (
		(values.isolatedDeployment ?? existing.isolatedDeployment) &&
		!(values.suffix || existing.suffix)
	) {
		values.suffix = randomSuffix();
	}

	const [updated] = await db
		.update(compose)
		.set(values)
		.where(eq(compose.composeId, composeId))
		.returning();
	if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
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

/** Source service names that have a Nixploy domain (the Traefik targets). */
async function exposedServiceNames(composeId: string): Promise<Set<string>> {
	const rows = await db.query.domains.findMany({
		where: eq(domains.composeId, composeId),
		columns: { serviceName: true },
	});
	const names = new Set<string>();
	for (const row of rows) if (row.serviceName) names.add(row.serviceName);
	return names;
}

/**
 * Materialize everything a deploy needs on disk: clone the git source when
 * applicable, render the compose file (env interpolated, safety-checked,
 * suffix + networks injected) to `docker-compose.nixploy.yml`, and write the
 * merged project → environment → service env file.
 * Also used by the deploy engine's worker for compose jobs.
 */
export async function prepareComposeFiles(composeRow: ComposeRow): Promise<PreparedComposeFiles> {
	const { appName } = composeRow;
	const envFilePath = getComposeEnvPath(appName);
	const composeFilePath = getComposeDeployFilePath(appName);
	let rawContent: string;
	let secrets: string[] = [];

	if (composeRow.sourceType === "raw") {
		rawContent = composeRow.composeFile;
		if (!rawContent.trim()) {
			throw new Error("Compose file is empty — save a compose file before deploying");
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

	const transformed = buildDeployComposeFile(
		rawContent,
		{
			appName,
			composeType: composeRow.composeType,
			suffix: composeSuffix(composeRow),
			env,
			exposedServices: await exposedServiceNames(composeRow.composeId),
		},
		composeRow.hostPrivileged ? hostPrivilegedComposeSafety() : undefined,
	);
	// Both carry resolved secrets — owner-only.
	await writeComposeFile(composeRow, composeFilePath, transformed, { mode: 0o600 });
	await writeComposeFile(composeRow, envFilePath, `${mergedEnv}\n`, { mode: 0o600 });

	// Scrub the merged env from logs — values land in the rendered file and
	// Docker echoes parts of it on errors. Short tokens would redact too much.
	for (const value of Object.values(env)) {
		if (shouldRedactEnvValue(value)) secrets.push(value);
	}

	return { workDir: getComposeBaseDir(appName), composeFilePath, envFilePath, secrets };
}

// ── lifecycle commands ──────────────────────────────────────────────────────

/** The deploy command shown in the UI ("getDefaultCommand"). */
export function getDefaultCommand(row: ComposeRow): string {
	return buildComposeDeployCommand(row, { composeFilePath: getComposeDeployFilePath(row.appName) });
}

async function updateStatus(composeId: string, status: "idle" | "running" | "done" | "error") {
	await db.update(compose).set({ status }).where(eq(compose.composeId, composeId));
}

/** `docker compose up -d` / `docker stack deploy` for an already-prepared row. */
export async function startCompose(composeRow: ComposeRow): Promise<void> {
	await updateStatus(composeRow.composeId, "running");
	try {
		const files = await prepareComposeFiles(composeRow);
		await runComposeCommand(composeRow, buildComposeDeployCommand(composeRow, files), {
			cwd: files.workDir,
		});
		await updateStatus(composeRow.composeId, "running");
	} catch (error) {
		await updateStatus(composeRow.composeId, "error");
		throw error;
	}
}

/** Stop without removing: `docker compose stop`, or `docker stack rm` for stacks. */
export async function stopCompose(composeRow: ComposeRow): Promise<void> {
	try {
		const files = await prepareComposeFiles(composeRow);
		await runComposeCommand(composeRow, buildComposeStopCommand(composeRow, files), {
			cwd: files.workDir,
		});
	} finally {
		await updateStatus(composeRow.composeId, "idle");
	}
}

/**
 * Tear down the deployment, remove its Traefik configs and delete the row
 * (domains cascade). Docker failures are tolerated so a broken deployment
 * never blocks deletion.
 */
export async function deleteCompose(composeRow: ComposeRow): Promise<void> {
	const composeDomains = await db.query.domains.findMany({
		where: eq(domains.composeId, composeRow.composeId),
	});

	try {
		// When the files cannot be prepared (clone failure, file now failing
		// safety, empty file) fall back to the name-only teardown so the
		// containers never outlive the row.
		const files = await prepareComposeFiles(composeRow).catch(() => null);
		const command = files
			? buildComposeDownCommand(composeRow, files)
			: buildComposeFallbackDownCommand(composeRow);
		await runComposeCommand(composeRow, command, files ? { cwd: files.workDir } : {}).catch(
			() => {},
		);
	} catch {
		// best-effort teardown
	}

	const traefik = await getTraefik();
	if (traefik) {
		const serviceKeys = new Set<string>();
		for (const d of composeDomains) {
			serviceKeys.add(traefikAppName(composeRow, d.serviceName));
		}
		for (const key of serviceKeys) {
			await traefik.removeTraefikConfig(key, composeRow.serverId).catch(() => {});
		}
		await traefik.removeTraefikConfig(composeRow.appName, composeRow.serverId).catch(() => {});
	}

	await db.delete(compose).where(eq(compose.composeId, composeRow.composeId));
	const baseDir = getComposeBaseDir(composeRow.appName);
	if (composeRow.serverId) {
		await runComposeCommand(composeRow, `rm -rf ${shellQuote(baseDir)}`).catch(() => {});
	} else {
		await rm(baseDir, { recursive: true, force: true }).catch(() => {});
	}
	// Build logs live outside the compose dir and have no FK to cascade through.
	await removeServiceLogs(composeRow.appName).catch(() => {});
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
		const [networkId, attached] = await Promise.all([
			runComposeCommand(row, `docker network inspect --format '{{.Id}}' ${shellQuote(network)}`),
			runComposeCommand(
				row,
				`docker service inspect --format '{{json .Spec.TaskTemplate.Networks}}' ${shellQuote(stackServiceName(row, serviceName))}`,
			),
		]);
		const targets = (JSON.parse(attached.trim() || "[]") as Array<{ Target?: string }>).map(
			(entry) => entry.Target,
		);
		if (targets.includes(networkId.trim())) return;
		await runComposeCommand(row, sharedNetworkServiceUpdateCommand(row, serviceName));
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

	const composeDomains = await db.query.domains.findMany({
		where: eq(domains.composeId, composeId),
	});

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
			domains: serviceDomains.map((d) => ({
				host: d.host,
				port: d.port ?? 80,
				path: d.path,
				https: d.https,
				certificateType: d.certificateType,
				certificateId: d.certificateId,
			})),
		});
		// Best effort: the service may simply not be running yet.
		await ensureSharedNetworkAttached(row, serviceName).catch(() => {});
	}

	// Remove configs for services that no longer have any domain.
	try {
		const services = await loadServices(row);
		for (const serviceName of services) {
			if (!byService.has(serviceName)) {
				await traefik
					.removeTraefikConfig(traefikAppName(row, serviceName), row.serverId)
					.catch(() => {});
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
 */
export async function saveComposeFile(composeRow: ComposeRow, composeFile: string): Promise<void> {
	if (composeRow.sourceType !== "raw") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"The compose file of a git-backed service is edited in the repository (the checkout is reset on every deploy). Switch the source type to raw to edit it here.",
		});
	}
	// validate before persisting so a broken / unsafe file is rejected early
	listComposeServices(composeFile);
	assertSafeComposeSpec(
		parseComposeFile(composeFile),
		composeRow.hostPrivileged ? hostPrivilegedComposeSafety() : undefined,
	);
	await db.update(compose).set({ composeFile }).where(eq(compose.composeId, composeRow.composeId));
}

/** Ensure the base working directory exists (used by the fallback worker). */
export async function ensureComposeDirs(appName: string): Promise<void> {
	await mkdir(getComposeBaseDir(appName), { recursive: true });
}
