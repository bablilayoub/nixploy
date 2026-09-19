import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import {
	applications,
	compose,
	domainMiddlewares,
	domains,
	mounts,
	ports,
	redirects,
	security,
} from "../../db/schema";
import {
	assertBasicAuthUsername,
	assertComposeServiceName,
	assertSafeDockerImageRef,
	assertSafePublishedPort,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import { invalidateProtectedDomain } from "../app-auth/index";
import type { NixployAuthConfig } from "../app-auth/policy";
import {
	createApplication,
	materializeFileMount,
	removeFileMount,
	syncApplicationTraefik,
	updateApplication,
	upsertApplicationSwarmService,
} from "../application/service";
import {
	createCompose,
	resyncComposeDomains,
	saveComposeFile,
	updateComposeById,
} from "../compose/service";
import { DATABASE_CONFIGS, generateDatabaseAppName } from "../databases/engine";
import { badRequest, notFound, preconditionFailed } from "../errors";
import { assertSafeMount } from "../services/mounts";
import {
	DATABASE_KIND_CREDENTIALS,
	DATABASE_KINDS,
	type DatabaseServiceKind,
	databaseDef,
} from "../services/registry";
import { assertForwardAuthAllowed, assertNixployAuthAllowed } from "../traefik/middleware-guards";
import { parseMiddlewareConfig } from "../traefik/middlewares";
import { assertSafeRedirectRule } from "../traefik/redirects";
import { randomPassword, resolveEnvironmentId, resolveProjectForStack } from "./export";
import {
	type DomainWithMiddlewares,
	type EnvironmentGraph,
	loadEnvironmentGraph,
	type MountRow,
	type PortRow,
	type RedirectRow,
	resolveRegistryByName,
	resolveServerByName,
	type SecurityRow,
} from "./live";
import {
	APPLICATION_FIELDS,
	APPLICATION_GROUP_COLUMNS,
	basicAuthKey,
	buildPlan,
	COMPOSE_FIELDS,
	COMPOSE_GROUP_COLUMNS,
	DATABASE_FIELDS,
	domainKey,
	type GitopsPlanItem,
	type GitopsPlanResult,
	type LiveService,
	type LiveStackState,
	mountKey,
	normalizeMiddlewares,
	portKey,
	redirectKey,
} from "./plan";
import {
	type GitopsApplication,
	type GitopsBasicAuth,
	type GitopsCompose,
	type GitopsDomain,
	type GitopsMount,
	type GitopsPort,
	type GitopsRedirect,
	HOOK_COLUMNS,
	type NixployStack,
	PREVIEW_COLUMNS,
	SWARM_COLUMNS,
} from "./schema";

const BCRYPT_ROUNDS = 10;

/** Manifest fields that are names, resolved to ids before the row is written. */
const REFERENCE_FIELDS = new Set(["registry", "pushRegistry", "server"]);

// ─── Live state ──────────────────────────────────────────────────────────────

/** Project a Drizzle row onto the columns the plan diffs. */
const pick = (row: object, fields: readonly string[]) => {
	const source = row as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		result[field] = source[field] ?? null;
	}
	return result;
};

const nameOf = (map: Map<string, string>, id: string | null | undefined): string | null =>
	id ? (map.get(id) ?? null) : null;

const liveDomains = (rows: DomainWithMiddlewares[]): LiveService["domains"] =>
	rows.map((domain) => ({
		host: domain.host,
		path: domain.path ?? "/",
		port: domain.port,
		https: domain.https,
		certificateType: domain.certificateType,
		serviceName: domain.serviceName,
		internalPath: domain.internalPath,
		middlewares: normalizeMiddlewares(domain.middlewares),
	}));

const liveMounts = (rows: MountRow[], includeSensitive: boolean): LiveService["mounts"] =>
	rows.map((mount) => ({
		type: mount.type,
		mountPath: mount.mountPath,
		hostPath: mount.hostPath,
		volumeName: mount.volumeName,
		filePath: mount.filePath,
		content: includeSensitive ? mount.content : undefined,
		serviceName: mount.serviceName,
	}));

const livePorts = (rows: PortRow[]): LiveService["ports"] =>
	rows.map((port) => ({
		published: port.publishedPort,
		target: port.targetPort,
		protocol: port.protocol,
		publishMode: port.publishMode,
	}));

const liveRedirects = (rows: RedirectRow[]): LiveService["redirects"] =>
	rows.map((redirect) => ({
		regex: redirect.regex,
		replacement: redirect.replacement,
		permanent: redirect.permanent,
		serviceName: redirect.serviceName,
	}));

const liveBasicAuth = (rows: SecurityRow[]): LiveService["basicAuth"] =>
	rows.map((entry) => ({ username: entry.username, serviceName: entry.serviceName }));

const liveApplication = (
	row: typeof applications.$inferSelect,
	graph: EnvironmentGraph,
	includeSensitive: boolean,
): LiveService => ({
	name: row.name,
	appName: row.appName,
	row: {
		...pick(row, APPLICATION_FIELDS),
		...pick(row, APPLICATION_GROUP_COLUMNS),
		registry: nameOf(graph.registryNameById, row.registryId),
		pushRegistry: nameOf(graph.registryNameById, row.pushRegistryId),
		server: nameOf(graph.serverNameById, row.serverId),
	},
	domains: liveDomains(graph.domainsByParent.get(row.applicationId) ?? []),
	mounts: liveMounts(graph.mountsByParent.get(row.applicationId) ?? [], includeSensitive),
	ports: livePorts(graph.portsByParent.get(row.applicationId) ?? []),
	redirects: liveRedirects(graph.redirectsByParent.get(row.applicationId) ?? []),
	basicAuth: liveBasicAuth(graph.securityByParent.get(row.applicationId) ?? []),
});

const liveCompose = (
	row: typeof compose.$inferSelect,
	graph: EnvironmentGraph,
	includeSensitive: boolean,
): LiveService => ({
	name: row.name,
	appName: row.appName,
	row: {
		...pick(row, COMPOSE_FIELDS),
		...pick(row, COMPOSE_GROUP_COLUMNS),
		composeFile: row.sourceType === "raw" ? row.composeFile : null,
		server: nameOf(graph.serverNameById, row.serverId),
	},
	domains: liveDomains(graph.domainsByParent.get(row.composeId) ?? []),
	mounts: liveMounts(graph.mountsByParent.get(row.composeId) ?? [], includeSensitive),
	ports: [],
	redirects: liveRedirects(graph.redirectsByParent.get(row.composeId) ?? []),
	basicAuth: liveBasicAuth(graph.securityByParent.get(row.composeId) ?? []),
});

export interface LoadLiveStackOptions {
	/** Whether file-mount contents may be compared (caller holds `secrets.read`). */
	includeSensitive?: boolean;
}

/** The live state snapshot the plan diffs, from an already-loaded graph. */
export const liveStateFromGraph = (
	projectId: string,
	environmentName: string,
	graph: EnvironmentGraph,
	options: LoadLiveStackOptions = {},
): LiveStackState => {
	const includeSensitive = options.includeSensitive === true;
	const { services } = graph;

	const liveDatabases = (kind: DatabaseServiceKind) =>
		services[kind].map((row) => ({
			name: row.name,
			row: {
				...pick(row, DATABASE_FIELDS),
				server: nameOf(graph.serverNameById, row.serverId),
			},
		}));

	return {
		projectId,
		environmentName,
		applications: services.applications.map((row) => liveApplication(row, graph, includeSensitive)),
		compose: services.compose.map((row) => liveCompose(row, graph, includeSensitive)),
		databases: {
			postgres: liveDatabases("postgres"),
			mysql: liveDatabases("mysql"),
			mariadb: liveDatabases("mariadb"),
			mongo: liveDatabases("mongo"),
			redis: liveDatabases("redis"),
		},
	};
};

/** Build the live state snapshot used by plan/apply. */
export const loadLiveStackState = async (
	projectId: string,
	environmentName: string,
	organizationId: string,
	options: LoadLiveStackOptions = {},
): Promise<LiveStackState> =>
	liveStateFromGraph(
		projectId,
		environmentName,
		await loadEnvironmentGraph(projectId, environmentName, organizationId),
		options,
	);

// ─── References by name ──────────────────────────────────────────────────────

interface ResolvedReferences {
	registryId?: string | null;
	pushRegistryId?: string | null;
	serverId?: string | null;
}

/**
 * Turn the manifest's `registry` / `pushRegistry` / `server` names into the
 * ids the row stores. `undefined` leaves the column alone; `null` clears it.
 */
const resolveReferences = async (
	desired: { registry?: string | null; pushRegistry?: string | null; server?: string | null },
	organizationId: string,
): Promise<ResolvedReferences> => {
	const resolved: ResolvedReferences = {};
	if (desired.registry !== undefined) {
		resolved.registryId = desired.registry
			? (await resolveRegistryByName(organizationId, desired.registry)).registryId
			: null;
	}
	if (desired.pushRegistry !== undefined) {
		if (desired.pushRegistry) {
			const target = await resolveRegistryByName(organizationId, desired.pushRegistry);
			if (!target.imagePrefix?.trim()) {
				throw preconditionFailed(
					`Registry "${target.registryName}" has no image prefix — set one before using it as a push target`,
				);
			}
			resolved.pushRegistryId = target.registryId;
		} else {
			resolved.pushRegistryId = null;
		}
	}
	if (desired.server !== undefined) {
		resolved.serverId = desired.server
			? (await resolveServerByName(organizationId, desired.server)).serverId
			: null;
	}
	return resolved;
};

/** Copy the nested manifest groups onto their row columns. */
const groupPatch = (
	desired: { hooks?: object; swarm?: object; previews?: object },
	columns: Array<[string, Record<string, string>]>,
): Record<string, unknown> => {
	const patch: Record<string, unknown> = {};
	for (const [group, mapping] of columns) {
		const values = (desired as Record<string, Record<string, unknown> | undefined>)[group];
		if (!values) continue;
		for (const [key, column] of Object.entries(mapping)) {
			if (values[key] !== undefined) patch[column] = values[key];
		}
	}
	return patch;
};

// ─── Domains ─────────────────────────────────────────────────────────────────

/** Row values for a domain the manifest declares but the environment lacks. */
const newDomainValues = (
	domain: GitopsDomain,
	parent: { applicationId?: string; composeId?: string },
): typeof domains.$inferInsert => {
	const host = assertTraefikHost(domain.host);
	const path = assertTraefikPath(domain.path ?? "/") ?? "/";
	const serviceName = parent.composeId ? (domain.serviceName ?? null) : null;
	if (serviceName) {
		assertComposeServiceName(serviceName);
	}
	return {
		host,
		path,
		internalPath: domain.internalPath ? assertTraefikPath(domain.internalPath) : null,
		port: domain.port ?? null,
		https: domain.https ?? false,
		certificateType: domain.certificateType ?? "none",
		certificateId: null,
		serviceName,
		domainType: parent.applicationId ? ("application" as const) : ("compose" as const),
		uniqueConfigKey: randomBytes(6).toString("hex"),
		applicationId: parent.applicationId ?? null,
		composeId: parent.composeId ?? null,
	};
};

/**
 * Patch for an existing domain: only fields the manifest defines. A
 * hand-written `domains: [{host}]` must keep the live Let's Encrypt setup —
 * `https ?? false` / `certificateType ?? "none"` would downgrade it to plain
 * HTTP and rewrite Traefik. `serviceName` only exists on compose domains.
 */
export const domainUpdatePatch = (
	domain: GitopsDomain,
	parent: { applicationId?: string; composeId?: string },
): Partial<typeof domains.$inferInsert> => {
	const patch: Partial<typeof domains.$inferInsert> = {};
	if (domain.https !== undefined) patch.https = domain.https;
	if (domain.certificateType !== undefined) patch.certificateType = domain.certificateType;
	if (domain.port !== undefined) patch.port = domain.port;
	if (domain.internalPath !== undefined) {
		patch.internalPath = domain.internalPath ? assertTraefikPath(domain.internalPath) : null;
	}
	if (parent.composeId && domain.serviceName !== undefined) {
		if (domain.serviceName) assertComposeServiceName(domain.serviceName);
		patch.serviceName = domain.serviceName;
	}
	return patch;
};

type ValidatedMiddleware = {
	kind: DomainWithMiddlewares["middlewares"][number]["kind"];
	config: unknown;
	enabled: boolean;
};

/**
 * Validate a middleware chain the way `domain.saveMiddlewares` does: shape
 * per kind, then the organization-bound targets. Everything is checked
 * before any row is touched so a bad entry never leaves a chain half-written
 * (Traefik would then drop the route).
 */
const validateMiddlewares = async (
	chain: NonNullable<GitopsDomain["middlewares"]>,
	organizationId: string,
): Promise<ValidatedMiddleware[]> => {
	const validated: ValidatedMiddleware[] = [];
	for (const entry of chain) {
		const config = parseMiddlewareConfig(entry.kind, entry.config ?? {});
		if (entry.kind === "forwardAuth") {
			await assertForwardAuthAllowed((config as { address: string }).address, organizationId);
		}
		if (entry.kind === "nixployAuth") {
			await assertNixployAuthAllowed(config as NixployAuthConfig, organizationId);
		}
		validated.push({ kind: entry.kind, config, enabled: entry.enabled ?? true });
	}
	return validated;
};

/**
 * Reconcile one service's domain rows against the manifest: create what is
 * missing, patch what changed, replace the middleware chains the manifest
 * spells out, delete what the manifest dropped.
 *
 * All of it runs in ONE transaction so a failure part-way cannot leave the
 * service with half its routes (the delete pass runs last, so without it a
 * crash used to drop live domains before their replacements existed). The
 * Traefik rewrite is a file-system side effect and is left to the caller,
 * after the commit — it is derived from the rows, so it is correct either way.
 *
 * Returns whether any row changed.
 */
const syncDomains = async (
	desired: GitopsDomain[] | undefined,
	live: DomainWithMiddlewares[],
	parent: { applicationId?: string; composeId?: string },
	organizationId: string,
	executor: DbExecutor = db,
): Promise<boolean> => {
	if (desired === undefined) return false;
	const liveByKey = new Map(live.map((row) => [domainKey(row), row]));

	// Validate every chain before the transaction opens.
	const chains = new Map<GitopsDomain, ValidatedMiddleware[]>();
	for (const domain of desired) {
		if (domain.middlewares !== undefined) {
			chains.set(domain, await validateMiddlewares(domain.middlewares, organizationId));
		}
	}

	let changed = false;
	const touchedChains: string[] = [];
	await executor.transaction(async (tx) => {
		for (const domain of desired) {
			const key = domainKey(domain);
			const existing = liveByKey.get(key);
			let domainId: string;
			if (!existing) {
				const [created] = await tx
					.insert(domains)
					.values(newDomainValues(domain, parent))
					.returning();
				if (!created) {
					throw new Error(`Failed to create domain ${domain.host}`);
				}
				domainId = created.domainId;
				changed = true;
			} else {
				domainId = existing.domainId;
				const patch = domainUpdatePatch(domain, parent);
				if (Object.keys(patch).length > 0) {
					await tx.update(domains).set(patch).where(eq(domains.domainId, existing.domainId));
					changed = true;
				}
				liveByKey.delete(key);
			}

			const chain = chains.get(domain);
			if (chain === undefined) continue;
			const current = normalizeMiddlewares(existing?.middlewares);
			const wanted = normalizeMiddlewares(chain);
			if (JSON.stringify(current) === JSON.stringify(wanted) && existing) continue;
			await tx.delete(domainMiddlewares).where(eq(domainMiddlewares.domainId, domainId));
			if (chain.length > 0) {
				await tx.insert(domainMiddlewares).values(
					chain.map((row, index) => ({
						domainId,
						kind: row.kind,
						config: row.config,
						order: index,
						enabled: row.enabled,
					})),
				);
			}
			touchedChains.push(domainId);
			changed = true;
		}

		// GitOps semantics: live domains absent from the desired stack are removed.
		for (const leftover of liveByKey.values()) {
			await tx.delete(domains).where(eq(domains.domainId, leftover.domainId));
			changed = true;
		}
	});

	// The verify endpoint caches panel-auth policies for ten seconds; a save
	// is the one moment where waiting that long is visibly wrong.
	for (const domainId of touchedChains) invalidateProtectedDomain(domainId);
	return changed;
};

// ─── Mounts ──────────────────────────────────────────────────────────────────

interface MountOwner {
	kind: "application" | "compose";
	appName: string;
	serverId: string | null;
	applicationId?: string;
	composeId?: string;
}

/**
 * Reconcile the mount rows of one service. Files are written to the server
 * the task runs on after the row exists (the deploy engine only resolves the
 * path, it never writes the file) and removed when their row goes away.
 */
const syncMounts = async (
	desired: GitopsMount[] | undefined,
	live: MountRow[],
	owner: MountOwner,
): Promise<boolean> => {
	if (desired === undefined) return false;
	const liveByKey = new Map(live.map((row) => [mountKey(row), row]));
	let changed = false;

	for (const mount of desired) {
		const key = mountKey(mount);
		const existing = liveByKey.get(key);
		const serviceName = owner.kind === "compose" ? (mount.serviceName ?? null) : null;
		if (!existing) {
			await assertSafeMount(owner.appName, mount);
			const [created] = await db
				.insert(mounts)
				.values({
					type: mount.type,
					mountPath: mount.mountPath,
					hostPath: mount.type === "bind" ? (mount.hostPath ?? null) : null,
					volumeName: mount.type === "volume" ? (mount.volumeName ?? null) : null,
					filePath: mount.type === "file" ? (mount.filePath ?? null) : null,
					content: mount.type === "file" ? (mount.content ?? null) : null,
					serviceName,
					serviceType: owner.kind,
					applicationId: owner.applicationId ?? null,
					composeId: owner.composeId ?? null,
				})
				.returning();
			if (!created) throw new Error(`Failed to create mount ${mount.mountPath}`);
			if (created.type === "file" && created.filePath) {
				await materializeFileMount(
					owner.appName,
					created.filePath,
					created.content ?? "",
					owner.serverId,
				);
			}
			changed = true;
			continue;
		}

		liveByKey.delete(key);
		const next = {
			type: mount.type,
			mountPath: mount.mountPath,
			hostPath: mount.hostPath !== undefined ? mount.hostPath : existing.hostPath,
			volumeName: mount.volumeName !== undefined ? mount.volumeName : existing.volumeName,
			filePath: mount.filePath !== undefined ? mount.filePath : existing.filePath,
			content: mount.content !== undefined ? mount.content : existing.content,
		};
		const same =
			next.type === existing.type &&
			(next.hostPath ?? null) === (existing.hostPath ?? null) &&
			(next.volumeName ?? null) === (existing.volumeName ?? null) &&
			(next.filePath ?? null) === (existing.filePath ?? null) &&
			(next.content ?? null) === (existing.content ?? null);
		if (same) continue;

		await assertSafeMount(owner.appName, next);
		await db
			.update(mounts)
			.set({
				type: next.type,
				hostPath: next.type === "bind" ? next.hostPath : null,
				volumeName: next.type === "volume" ? next.volumeName : null,
				filePath: next.type === "file" ? next.filePath : null,
				content: next.type === "file" ? next.content : null,
			})
			.where(eq(mounts.mountId, existing.mountId));
		// Clean up the old backing file when the mount no longer uses it.
		if (
			existing.type === "file" &&
			existing.filePath &&
			(next.type !== "file" || next.filePath !== existing.filePath)
		) {
			await removeFileMount(owner.appName, existing.filePath, owner.serverId);
		}
		if (next.type === "file" && next.filePath) {
			await materializeFileMount(owner.appName, next.filePath, next.content ?? "", owner.serverId);
		}
		changed = true;
	}

	for (const leftover of liveByKey.values()) {
		await db.delete(mounts).where(eq(mounts.mountId, leftover.mountId));
		if (leftover.type === "file" && leftover.filePath) {
			await removeFileMount(owner.appName, leftover.filePath, owner.serverId);
		}
		changed = true;
	}
	return changed;
};

// ─── Ports ───────────────────────────────────────────────────────────────────

const syncPorts = async (
	desired: GitopsPort[] | undefined,
	live: PortRow[],
	applicationId: string,
): Promise<boolean> => {
	if (desired === undefined) return false;
	const liveByKey = new Map(
		live.map((row) => [portKey({ published: row.publishedPort, protocol: row.protocol }), row]),
	);
	let changed = false;
	for (const port of desired) {
		assertSafePublishedPort(port.published);
		const existing = liveByKey.get(portKey(port));
		const values = {
			publishedPort: port.published,
			targetPort: port.target,
			protocol: port.protocol ?? ("tcp" as const),
			publishMode: port.publishMode ?? ("ingress" as const),
		};
		if (!existing) {
			await db.insert(ports).values({ ...values, applicationId });
			changed = true;
			continue;
		}
		liveByKey.delete(portKey(port));
		const patch: Partial<typeof ports.$inferInsert> = {};
		if (port.target !== existing.targetPort) patch.targetPort = port.target;
		if (port.publishMode !== undefined && port.publishMode !== existing.publishMode) {
			patch.publishMode = port.publishMode;
		}
		if (Object.keys(patch).length > 0) {
			await db.update(ports).set(patch).where(eq(ports.portId, existing.portId));
			changed = true;
		}
	}
	for (const leftover of liveByKey.values()) {
		await db.delete(ports).where(eq(ports.portId, leftover.portId));
		changed = true;
	}
	return changed;
};

// ─── Redirects ───────────────────────────────────────────────────────────────

const syncRedirects = async (
	desired: GitopsRedirect[] | undefined,
	live: RedirectRow[],
	owner: MountOwner,
	ownHosts: string[],
): Promise<boolean> => {
	if (desired === undefined) return false;
	const liveByKey = new Map(live.map((row) => [redirectKey(row), row]));
	let changed = false;
	for (const redirect of desired) {
		const serviceName = owner.kind === "compose" ? (redirect.serviceName ?? null) : null;
		if (serviceName) assertComposeServiceName(serviceName);
		assertSafeRedirectRule(redirect.regex, redirect.replacement, ownHosts);
		const existing = liveByKey.get(redirectKey(redirect));
		if (!existing) {
			await db.insert(redirects).values({
				regex: redirect.regex,
				replacement: redirect.replacement,
				permanent: redirect.permanent ?? false,
				serviceName,
				applicationId: owner.applicationId ?? null,
				composeId: owner.composeId ?? null,
			});
			changed = true;
			continue;
		}
		liveByKey.delete(redirectKey(redirect));
		const patch: Partial<typeof redirects.$inferInsert> = {};
		if (redirect.replacement !== existing.replacement) patch.replacement = redirect.replacement;
		if (redirect.permanent !== undefined && redirect.permanent !== existing.permanent) {
			patch.permanent = redirect.permanent;
		}
		if (Object.keys(patch).length > 0) {
			await db.update(redirects).set(patch).where(eq(redirects.redirectId, existing.redirectId));
			changed = true;
		}
	}
	for (const leftover of liveByKey.values()) {
		await db.delete(redirects).where(eq(redirects.redirectId, leftover.redirectId));
		changed = true;
	}
	return changed;
};

// ─── Basic auth ──────────────────────────────────────────────────────────────

const syncBasicAuth = async (
	desired: GitopsBasicAuth[] | undefined,
	live: SecurityRow[],
	owner: MountOwner,
): Promise<boolean> => {
	if (desired === undefined) return false;
	const liveByKey = new Map(live.map((row) => [basicAuthKey(row), row]));
	let changed = false;
	for (const entry of desired) {
		const serviceName = owner.kind === "compose" ? (entry.serviceName ?? null) : null;
		if (serviceName) assertComposeServiceName(serviceName);
		assertBasicAuthUsername(entry.username);
		const existing = liveByKey.get(basicAuthKey(entry));
		if (!existing) {
			if (!entry.password) {
				throw badRequest(
					`basicAuth "${entry.username}" is new and needs a password (omit it again once the entry exists)`,
				);
			}
			// Traefik's basicAuth middleware expects bcrypt-hashed passwords.
			await db.insert(security).values({
				username: entry.username,
				password: await bcrypt.hash(entry.password, BCRYPT_ROUNDS),
				serviceName,
				applicationId: owner.applicationId ?? null,
				composeId: owner.composeId ?? null,
			});
			changed = true;
			continue;
		}
		liveByKey.delete(basicAuthKey(entry));
		if (entry.password !== undefined) {
			await db
				.update(security)
				.set({ password: await bcrypt.hash(entry.password, BCRYPT_ROUNDS) })
				.where(eq(security.securityId, existing.securityId));
			changed = true;
		}
	}
	for (const leftover of liveByKey.values()) {
		await db.delete(security).where(eq(security.securityId, leftover.securityId));
		changed = true;
	}
	return changed;
};

// ─── Services ────────────────────────────────────────────────────────────────

interface ApplyContext {
	organizationId: string;
	environmentId: string;
	graph: EnvironmentGraph;
}

const hostsOf = (desired: GitopsDomain[] | undefined, live: Array<{ host: string }>): string[] =>
	[...new Set([...(desired ?? []).map((row) => row.host), ...live.map((row) => row.host)])].map(
		(host) => host.toLowerCase(),
	);

/** Row columns whose change means the running Swarm service must be re-specified. */
const APPLICATION_SPEC_COLUMNS = new Set([
	"replicas",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"command",
	"serverId",
	...Object.values(SWARM_COLUMNS),
]);

const applyApplication = async (
	desired: GitopsApplication,
	ctx: ApplyContext,
	live?: LiveService,
): Promise<void> => {
	let application: typeof applications.$inferSelect;
	if (!live) {
		application = await createApplication({
			name: desired.name,
			description: desired.description ?? null,
			environmentId: ctx.environmentId,
			appName: desired.appName,
		});
	} else {
		const existing = await db.query.applications.findFirst({
			where: and(
				eq(applications.environmentId, ctx.environmentId),
				eq(applications.name, desired.name),
			),
		});
		if (!existing) {
			throw notFound(`Application "${desired.name}" not found`);
		}
		application = existing;
	}
	const applicationId = application.applicationId;

	const patch: Record<string, unknown> = {
		...groupPatch(desired, [
			["hooks", HOOK_COLUMNS],
			["swarm", SWARM_COLUMNS],
			["previews", PREVIEW_COLUMNS],
		]),
		...(await resolveReferences(desired, ctx.organizationId)),
	};
	for (const field of APPLICATION_FIELDS) {
		if (REFERENCE_FIELDS.has(field)) continue;
		const value = desired[field];
		if (value !== undefined) patch[field] = value;
	}
	if (typeof patch.dockerImage === "string" && patch.dockerImage.length > 0) {
		patch.dockerImage = assertSafeDockerImageRef(patch.dockerImage);
	}
	if (Object.keys(patch).length > 0) {
		application = await updateApplication(
			applicationId,
			patch as Partial<typeof applications.$inferInsert>,
		);
	}

	const owner: MountOwner = {
		kind: "application",
		appName: application.appName,
		serverId: application.serverId,
		applicationId,
	};
	const liveDomainRows = ctx.graph.domainsByParent.get(applicationId) ?? [];
	const domainsChanged = await syncDomains(
		desired.domains,
		liveDomainRows,
		{ applicationId },
		ctx.organizationId,
	);
	const mountsChanged = await syncMounts(
		desired.mounts,
		ctx.graph.mountsByParent.get(applicationId) ?? [],
		owner,
	);
	const portsChanged = await syncPorts(
		desired.ports,
		ctx.graph.portsByParent.get(applicationId) ?? [],
		applicationId,
	);
	const redirectsChanged = await syncRedirects(
		desired.redirects,
		ctx.graph.redirectsByParent.get(applicationId) ?? [],
		owner,
		hostsOf(desired.domains, liveDomainRows),
	);
	const authChanged = await syncBasicAuth(
		desired.basicAuth,
		ctx.graph.securityByParent.get(applicationId) ?? [],
		owner,
	);

	if (domainsChanged || redirectsChanged || authChanged) {
		await syncApplicationTraefik(application);
	}
	const specChanged = Object.keys(patch).some((column) => APPLICATION_SPEC_COLUMNS.has(column));
	if (specChanged || mountsChanged || portsChanged) {
		// A never-deployed application has no image yet; the upsert is a no-op then.
		await upsertApplicationSwarmService(application);
	}
};

const applyCompose = async (
	desired: GitopsCompose,
	ctx: ApplyContext,
	live?: LiveService,
): Promise<void> => {
	let composeRow: typeof compose.$inferSelect;
	if (!live) {
		composeRow = await createCompose({
			name: desired.name,
			description: desired.description ?? null,
			environmentId: ctx.environmentId,
			composeType: desired.composeType ?? "docker-compose",
			sourceType: desired.sourceType ?? "raw",
			appName: desired.appName,
		});
	} else {
		const existing = await db.query.compose.findFirst({
			where: and(eq(compose.environmentId, ctx.environmentId), eq(compose.name, desired.name)),
		});
		if (!existing) {
			throw notFound(`Compose service "${desired.name}" not found`);
		}
		composeRow = existing;
	}
	const composeId = composeRow.composeId;

	const patch: Record<string, unknown> = {
		...groupPatch(desired, [
			["hooks", HOOK_COLUMNS],
			["previews", PREVIEW_COLUMNS],
		]),
		...(await resolveReferences(desired, ctx.organizationId)),
	};
	for (const field of COMPOSE_FIELDS) {
		if (REFERENCE_FIELDS.has(field) || field === "composeFile") continue;
		const value = desired[field];
		if (value !== undefined) patch[field] = value;
	}
	if (Object.keys(patch).length > 0) {
		composeRow = await updateComposeById(
			composeId,
			patch as Parameters<typeof updateComposeById>[1],
		);
	}

	if (desired.composeFile !== undefined && composeRow.sourceType === "raw") {
		if (composeRow.hostPrivileged) {
			throw preconditionFailed(
				`Compose "${desired.name}" is host-privileged; update its compose file as instance admin in the UI (GitOps cannot rewrite docker.sock stacks)`,
			);
		}
		await saveComposeFile(composeRow, desired.composeFile);
	}

	const owner: MountOwner = {
		kind: "compose",
		appName: composeRow.appName,
		serverId: composeRow.serverId,
		composeId,
	};
	const liveDomainRows = ctx.graph.domainsByParent.get(composeId) ?? [];
	const domainsChanged = await syncDomains(
		desired.domains,
		liveDomainRows,
		{ composeId },
		ctx.organizationId,
	);
	// Compose mounts land on the next deploy: the file is rendered then.
	await syncMounts(desired.mounts, ctx.graph.mountsByParent.get(composeId) ?? [], owner);
	const redirectsChanged = await syncRedirects(
		desired.redirects,
		ctx.graph.redirectsByParent.get(composeId) ?? [],
		owner,
		hostsOf(desired.domains, liveDomainRows),
	);
	const authChanged = await syncBasicAuth(
		desired.basicAuth,
		ctx.graph.securityByParent.get(composeId) ?? [],
		owner,
	);
	if (domainsChanged || redirectsChanged || authChanged) {
		await resyncComposeDomains(composeId);
	}
};

const applyDatabase = async (
	kind: DatabaseServiceKind,
	desired: Record<string, unknown>,
	ctx: ApplyContext,
	live?: { name: string; row: Record<string, unknown> },
): Promise<void> => {
	const { module } = databaseDef(kind);
	const references = await resolveReferences(
		desired as { server?: string | null },
		ctx.organizationId,
	);

	if (!live) {
		const credentials = DATABASE_KIND_CREDENTIALS[kind];
		const config = DATABASE_CONFIGS[kind];
		const dockerImage = assertSafeDockerImageRef(
			(desired.dockerImage as string | undefined) ?? config.defaultImage,
		);
		await module.insert({
			name: String(desired.name),
			description: (desired.description as string | null | undefined) ?? null,
			environmentId: ctx.environmentId,
			appName:
				(desired.appName as string | undefined) ?? generateDatabaseAppName(String(desired.name)),
			dockerImage,
			externalPort: (() => {
				const port = (desired.externalPort as number | null | undefined) ?? null;
				if (port != null) assertSafePublishedPort(port, "externalPort");
				return port;
			})(),
			command: (desired.command as string | null | undefined) ?? null,
			memoryReservation: (desired.memoryReservation as string | null | undefined) ?? null,
			memoryLimit: (desired.memoryLimit as string | null | undefined) ?? null,
			cpuReservation: (desired.cpuReservation as string | null | undefined) ?? null,
			cpuLimit: (desired.cpuLimit as string | null | undefined) ?? null,
			serverId: references.serverId ?? null,
			// Only the columns the engine actually has (redis has neither user
			// nor database name, mongo has no database name, mysql/mariadb add a
			// root password) — see DATABASE_KIND_CREDENTIALS.
			...(credentials.databaseName !== null
				? {
						databaseName: (desired.databaseName as string | undefined) ?? credentials.databaseName,
					}
				: {}),
			...(credentials.databaseUser !== null
				? { databaseUser: (desired.databaseUser as string | undefined) ?? credentials.databaseUser }
				: {}),
			databasePassword: randomPassword(),
			...(credentials.rootPassword ? { databaseRootPassword: randomPassword() } : {}),
		});
		return;
	}

	const patch: Record<string, unknown> = { ...references };
	for (const field of DATABASE_FIELDS) {
		if (REFERENCE_FIELDS.has(field)) continue;
		const value = desired[field];
		if (value !== undefined) {
			patch[field] = value;
		}
	}
	if (typeof patch.externalPort === "number") {
		assertSafePublishedPort(patch.externalPort, "externalPort");
	}
	if (typeof patch.dockerImage === "string" && patch.dockerImage.length > 0) {
		patch.dockerImage = assertSafeDockerImageRef(patch.dockerImage);
	}
	if (Object.keys(patch).length === 0) return;

	// Look the row up and patch it in one transaction: the row a concurrent
	// apply/rename could move out from under us is the row we write.
	await db.transaction(async (tx) => {
		const existing = await module.findByName(ctx.environmentId, String(desired.name), tx);
		if (!existing) return;
		await module.updateById(module.rowId(existing), patch, tx);
	});
};

// ─── Plan / apply ────────────────────────────────────────────────────────────

export interface PlanStackOptions extends LoadLiveStackOptions {}

export const planStack = async (
	stack: NixployStack,
	organizationId: string,
	projectId?: string,
	options: PlanStackOptions = {},
): Promise<GitopsPlanResult> => {
	const project = await resolveProjectForStack(organizationId, stack, projectId);
	const { environmentName } = await resolveEnvironmentId(project.projectId, stack);
	const live = await loadLiveStackState(
		project.projectId,
		environmentName,
		organizationId,
		options,
	);
	return buildPlan(stack, live);
};

export interface ApplyStackResult extends GitopsPlanResult {
	applied: number;
	/** Services that could not be applied — the rest of the stack was still written. */
	errors: Array<{
		kind: GitopsPlanItem["kind"];
		name: string;
		message: string;
	}>;
}

const planAction = (
	plan: GitopsPlanResult,
	kind: GitopsPlanResult["items"][number]["kind"],
	name: string,
): GitopsPlanResult["items"][number]["action"] | undefined =>
	plan.items.find((item) => item.kind === kind && item.name === name && !item.parent)?.action;

/**
 * Apply a desired stack to the live project/environment (no deploy engine).
 *
 * The service writers (`createApplication`, `updateComposeById`, …) run on the
 * shared `db` handle with Traefik/file side effects, so the apply is not one
 * big transaction. Instead every service is applied independently: a failure
 * (e.g. a domain host already taken by another service) is recorded on that
 * item and in `errors`, and the remaining services still apply. Failed items
 * are never redeployed.
 *
 * Atomicity is per service instead: a service's domain set is reconciled in
 * one transaction ({@link syncDomains}) and a database patch in another, so a
 * failed item leaves no half-written rows behind. Threading one transaction
 * through the application/compose writers as well is follow-up work — they
 * interleave file and Swarm side effects with their row writes.
 */
export const applyStack = async (
	stack: NixployStack,
	organizationId: string,
	projectId?: string,
	options: PlanStackOptions = {},
): Promise<ApplyStackResult> => {
	const project = await resolveProjectForStack(organizationId, stack, projectId);
	const { environmentId, environmentName } = await resolveEnvironmentId(project.projectId, stack);
	// One snapshot for the plan and the writes: every service is reconciled
	// against the rows the plan was computed from.
	const graph = await loadEnvironmentGraph(project.projectId, environmentName, organizationId);
	const live = liveStateFromGraph(project.projectId, environmentName, graph, options);
	const plan = buildPlan(stack, live);
	const ctx: ApplyContext = { organizationId, environmentId, graph };
	const errors: ApplyStackResult["errors"] = [];

	const attempt = async (
		kind: GitopsPlanItem["kind"],
		name: string,
		fn: () => Promise<void>,
	): Promise<void> => {
		try {
			await fn();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ kind, name, message });
			for (const item of plan.items) {
				if (item.kind === kind && item.name === name && !item.parent) item.error = message;
				if (item.parent === name && item.parentKind === kind) item.error = message;
			}
		}
	};

	for (const app of stack.applications ?? []) {
		if (app.environment !== environmentName) continue;
		const existing = live.applications.find((row) => row.name === app.name);
		await attempt("application", app.name, () => applyApplication(app, ctx, existing));
	}

	for (const row of stack.compose ?? []) {
		if (row.environment !== environmentName) continue;
		const existing = live.compose.find((entry) => entry.name === row.name);
		await attempt("compose", row.name, () => applyCompose(row, ctx, existing));
	}

	for (const kind of DATABASE_KINDS) {
		for (const dbDesired of stack.databases?.[kind] ?? []) {
			if (dbDesired.environment !== environmentName) continue;
			const existing = live.databases[kind].find((entry) => entry.name === dbDesired.name);
			if (planAction(plan, kind, dbDesired.name) === "noop") continue;
			await attempt(kind, dbDesired.name, () =>
				applyDatabase(kind, dbDesired as Record<string, unknown>, ctx, existing),
			);
		}
	}

	return {
		...plan,
		applied: plan.items.filter((item) => item.action !== "noop" && !item.error).length,
		errors,
	};
};
