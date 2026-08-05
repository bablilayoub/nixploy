import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, domains, environments, mounts } from "../../db/schema";
import { removeServiceLogs } from "../deployment/maintenance";
import { getTraefik } from "./adapters";
import { buildDeployComposeFile, listComposeServices, mergeEnvVars } from "./compose-file";
import { getComposeBaseDir, getComposeEnvPath, resolveComposeFilePath, shellQuote } from "./paths";
import {
	type ComposeRow,
	cloneComposeSource,
	readComposeFile,
	runComposeCommand,
	writeComposeFile,
} from "./source";

export type { ComposeRow };

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
}

export async function createCompose(input: CreateComposeInput): Promise<ComposeRow> {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, input.environmentId),
		with: { project: true },
	});
	if (!environment) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
	}
	const appName = input.appName ?? (await generateUniqueAppName(input.name));
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
		.values({ ...rest, appName, environmentId, status: "idle" })
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

export async function updateComposeById(
	composeId: string,
	input: Partial<Omit<typeof compose.$inferInsert, "composeId" | "environmentId" | "createdAt">>,
): Promise<ComposeRow> {
	if (input.appName && (await isAppNameTaken(input.appName))) {
		const existing = await db.query.compose.findFirst({
			where: eq(compose.composeId, composeId),
		});
		if (existing?.appName !== input.appName) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `appName "${input.appName}" is already in use`,
			});
		}
	}
	const [updated] = await db
		.update(compose)
		.set(input)
		.where(eq(compose.composeId, composeId))
		.returning();
	if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	return updated;
}

// ── file preparation ────────────────────────────────────────────────────────

export interface PreparedComposeFiles {
	/** Directory compose commands run in. */
	workDir: string;
	/** Final (transformed) compose file passed with `-f`. */
	composeFilePath: string;
	/** Merged env file passed with `--env-file`. */
	envFilePath: string;
}

/**
 * Materialize everything a deploy needs on disk: clone the git source when
 * applicable, apply suffix/network transforms to the compose file, and write
 * the merged project → environment → service env file.
 * Also used by the deploy engine's worker for compose jobs.
 */
export async function prepareComposeFiles(composeRow: ComposeRow): Promise<PreparedComposeFiles> {
	const { appName } = composeRow;
	const envFilePath = getComposeEnvPath(appName);
	let composeFilePath: string;
	let rawContent: string;

	if (composeRow.sourceType === "raw") {
		composeFilePath = resolveComposeFilePath(appName, "raw", composeRow.composePath);
		rawContent = composeRow.composeFile;
		if (!rawContent.trim()) {
			throw new Error("Compose file is empty — save a compose file before deploying");
		}
	} else {
		await cloneComposeSource(composeRow);
		composeFilePath = resolveComposeFilePath(
			appName,
			composeRow.sourceType,
			composeRow.composePath,
		);
		rawContent = await readComposeFile(composeRow, composeFilePath);
	}

	const transformed = buildDeployComposeFile(rawContent, {
		appName,
		composeType: composeRow.composeType,
		suffix: composeRow.isolatedDeployment ? composeRow.suffix : null,
	});
	await writeComposeFile(composeRow, composeFilePath, transformed);

	// Env inheritance: project → environment → service (service wins).
	const full = await findComposeById(composeRow.composeId);
	const mergedEnv = mergeEnvVars(
		full?.environment.project.env,
		full?.environment.env,
		composeRow.env,
	);
	await writeComposeFile(composeRow, envFilePath, `${mergedEnv}\n`);

	return { workDir: dirname(composeFilePath), composeFilePath, envFilePath };
}

// ── lifecycle commands ──────────────────────────────────────────────────────

const upCommand = (row: ComposeRow, files: PreparedComposeFiles) => {
	const f = shellQuote(files.composeFilePath);
	const env = shellQuote(files.envFilePath);
	if (row.composeType === "stack") {
		// `docker stack deploy` has no --env-file; render the interpolated file
		// with `docker compose config` and feed it via stdin instead.
		return `docker compose -f ${f} --env-file ${env} config | docker stack deploy --with-registry-auth --prune -c - ${shellQuote(row.appName)}`;
	}
	return `docker compose -p ${shellQuote(row.appName)} -f ${f} --env-file ${env} up -d --remove-orphans`;
};

const stopCommand = (row: ComposeRow, files: PreparedComposeFiles) => {
	if (row.composeType === "stack") {
		return `docker stack rm ${shellQuote(row.appName)}`;
	}
	return `docker compose -p ${shellQuote(row.appName)} -f ${shellQuote(files.composeFilePath)} --env-file ${shellQuote(files.envFilePath)} stop`;
};

const downCommand = (row: ComposeRow, files: PreparedComposeFiles) => {
	if (row.composeType === "stack") {
		return `docker stack rm ${shellQuote(row.appName)}`;
	}
	return `docker compose -p ${shellQuote(row.appName)} -f ${shellQuote(files.composeFilePath)} --env-file ${shellQuote(files.envFilePath)} down --remove-orphans`;
};

/** The deploy command shown in the UI ("getDefaultCommand"). */
export function getDefaultCommand(row: ComposeRow): string {
	const composeFilePath = resolveComposeFilePath(row.appName, row.sourceType, row.composePath);
	return upCommand(row, {
		workDir: dirname(composeFilePath),
		composeFilePath,
		envFilePath: getComposeEnvPath(row.appName),
	});
}

async function updateStatus(composeId: string, status: "idle" | "running" | "done" | "error") {
	await db.update(compose).set({ status }).where(eq(compose.composeId, composeId));
}

/** `docker compose up -d` / `docker stack deploy` for an already-prepared row. */
export async function startCompose(composeRow: ComposeRow): Promise<void> {
	await updateStatus(composeRow.composeId, "running");
	try {
		const files = await prepareComposeFiles(composeRow);
		await runComposeCommand(composeRow, upCommand(composeRow, files), { cwd: files.workDir });
		await updateStatus(composeRow.composeId, "done");
	} catch (error) {
		await updateStatus(composeRow.composeId, "error");
		throw error;
	}
}

/** Stop without removing: `docker compose stop`, or `docker stack rm` for stacks. */
export async function stopCompose(composeRow: ComposeRow): Promise<void> {
	try {
		const files = await prepareComposeFiles(composeRow);
		await runComposeCommand(composeRow, stopCommand(composeRow, files), { cwd: files.workDir });
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
		const files = await prepareComposeFiles(composeRow).catch(() => null);
		if (files) {
			await runComposeCommand(composeRow, downCommand(composeRow, files), {
				cwd: files.workDir,
			}).catch(() => {});
		} else if (composeRow.composeType === "stack") {
			await runComposeCommand(
				composeRow,
				`docker stack rm ${shellQuote(composeRow.appName)}`,
			).catch(() => {});
		}
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
	if (!composeRow.serverId) {
		await rm(getComposeBaseDir(composeRow.appName), { recursive: true, force: true }).catch(
			() => {},
		);
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
 * Traefik config key for one compose service — this is also the hostname the
 * service is reachable at on `nixploy-network`:
 * - docker-compose: `<appName>-<serviceName>` (network alias injected at deploy)
 * - stack: `<appName>_<serviceName>` (native swarm DNS)
 */
export function traefikAppName(row: ComposeRow, serviceName: string | null): string {
	const name = serviceName ?? "";
	return row.composeType === "stack" ? `${row.appName}_${name}` : `${row.appName}-${name}`;
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
 * Save the compose file. For raw sources this updates the `composeFile`
 * column; for git sources it overwrites the file inside the local clone.
 */
export async function saveComposeFile(composeRow: ComposeRow, composeFile: string): Promise<void> {
	// validate before persisting so a broken file is rejected early
	listComposeServices(composeFile);
	if (composeRow.sourceType === "raw") {
		await db
			.update(compose)
			.set({ composeFile })
			.where(eq(compose.composeId, composeRow.composeId));
		return;
	}
	if (composeRow.serverId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Compose files on remote servers are edited in the repository",
		});
	}
	const path = resolveComposeFilePath(
		composeRow.appName,
		composeRow.sourceType,
		composeRow.composePath,
	);
	await mkdir(dirname(path), { recursive: true });
	await writeComposeFile(composeRow, path, composeFile);
}

/** Ensure the base working directory exists (used by the fallback worker). */
export async function ensureComposeDirs(appName: string): Promise<void> {
	await mkdir(getComposeBaseDir(appName), { recursive: true });
}
