import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { applications, compose, domains, environments } from "../../db/schema";
import {
	assertComposeServiceName,
	assertSafeDockerImageRef,
	assertSafePublishedPort,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import {
	createApplication,
	syncApplicationTraefik,
	updateApplication,
} from "../application/service";
import {
	createCompose,
	resyncComposeDomains,
	saveComposeFile,
	updateComposeById,
} from "../compose/service";
import { DATABASE_CONFIGS, generateDatabaseAppName } from "../databases/engine";
import { notFound, preconditionFailed } from "../errors";
import { getEnvironmentServices } from "../projects";
import {
	DATABASE_KIND_CREDENTIALS,
	DATABASE_KINDS,
	type DatabaseServiceKind,
	databaseDef,
} from "../services/registry";
import { randomPassword, resolveEnvironmentId, resolveProjectForStack } from "./export";
import { buildPlan, type GitopsPlanItem, type GitopsPlanResult, type LiveStackState } from "./plan";
import type { GitopsDomain, NixployStack } from "./schema";

const domainKey = (domain: GitopsDomain) =>
	`${domain.host}|${domain.path ?? "/"}|${domain.port ?? ""}`;

const APPLICATION_FIELDS = [
	"description",
	"buildType",
	"sourceType",
	"repository",
	"owner",
	"branch",
	"buildPath",
	"dockerImage",
	"replicas",
	"command",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"autoDeploy",
	"dockerfile",
] as const;

const COMPOSE_FIELDS = [
	"description",
	"composeType",
	"sourceType",
	"composePath",
	"repository",
	"owner",
	"branch",
	"autoDeploy",
] as const;

const DATABASE_FIELDS = [
	"description",
	"dockerImage",
	"externalPort",
	"command",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"databaseName",
	"databaseUser",
] as const;

/** Build the live state snapshot used by plan/apply. */
export const loadLiveStackState = async (
	projectId: string,
	environmentName: string,
): Promise<LiveStackState> => {
	const environment = await db.query.environments.findFirst({
		where: and(eq(environments.projectId, projectId), eq(environments.name, environmentName)),
	});
	if (!environment) {
		throw notFound(`Environment "${environmentName}" not found`);
	}

	const services = await getEnvironmentServices(environment.environmentId);
	const [applicationDomains, composeDomains] = await Promise.all([
		Promise.all(
			services.applications.map(async (app) => ({
				applicationId: app.applicationId,
				domains: await db.query.domains.findMany({
					where: eq(domains.applicationId, app.applicationId),
				}),
			})),
		),
		Promise.all(
			services.compose.map(async (row) => ({
				composeId: row.composeId,
				domains: await db.query.domains.findMany({
					where: eq(domains.composeId, row.composeId),
				}),
			})),
		),
	]);
	const domainsByApplication = new Map(
		applicationDomains.map((entry) => [entry.applicationId, entry.domains]),
	);
	const domainsByCompose = new Map(composeDomains.map((entry) => [entry.composeId, entry.domains]));

	/** Project a Drizzle row onto the manifest fields the plan diffs. */
	const pick = (row: object, fields: readonly string[]) => {
		const source = row as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const field of fields) {
			result[field] = source[field] ?? null;
		}
		return result;
	};

	const liveDatabases = (kind: DatabaseServiceKind) =>
		services[kind].map((row) => ({ name: row.name, row: pick(row, DATABASE_FIELDS) }));

	return {
		projectId,
		environmentName,
		applications: services.applications.map((row) => ({
			name: row.name,
			appName: row.appName,
			row: pick(row, APPLICATION_FIELDS),
			domains: (domainsByApplication.get(row.applicationId) ?? []).map((domain) => ({
				host: domain.host,
				path: domain.path ?? "/",
				port: domain.port,
				https: domain.https,
				certificateType: domain.certificateType,
				serviceName: domain.serviceName,
			})),
		})),
		compose: services.compose.map((row) => ({
			name: row.name,
			appName: row.appName,
			row: {
				...pick(row, COMPOSE_FIELDS),
				composeFile: row.sourceType === "raw" ? row.composeFile : null,
			},
			domains: (domainsByCompose.get(row.composeId) ?? []).map((domain) => ({
				host: domain.host,
				path: domain.path ?? "/",
				port: domain.port,
				https: domain.https,
				certificateType: domain.certificateType,
				serviceName: domain.serviceName,
			})),
		})),
		databases: {
			postgres: liveDatabases("postgres"),
			mysql: liveDatabases("mysql"),
			mariadb: liveDatabases("mariadb"),
			mongo: liveDatabases("mongo"),
			redis: liveDatabases("redis"),
		},
	};
};

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
	if (parent.composeId && domain.serviceName !== undefined) {
		if (domain.serviceName) assertComposeServiceName(domain.serviceName);
		patch.serviceName = domain.serviceName;
	}
	return patch;
};

/**
 * Reconcile one service's domain rows against the manifest: create what is
 * missing, patch what changed, delete what the manifest dropped.
 *
 * All three run in ONE transaction so a failure part-way cannot leave the
 * service with half its routes (the delete pass runs last, so without it a
 * crash used to drop live domains before their replacements existed). The
 * Traefik rewrite is a file-system side effect and stays outside, after the
 * commit — it is derived from the rows, so it is correct either way.
 */
const syncDomains = async (
	desired: GitopsDomain[] | undefined,
	liveDomains: Array<{
		domainId: string;
		host: string;
		path: string | null;
		port: number | null;
	}>,
	parent: { applicationId?: string; composeId?: string },
	executor: DbExecutor = db,
): Promise<void> => {
	const liveByKey = new Map(
		liveDomains.map((row) => [`${row.host}|${row.path ?? "/"}|${row.port ?? ""}`, row]),
	);

	await executor.transaction(async (tx) => {
		for (const domain of desired ?? []) {
			const key = domainKey(domain);
			const existing = liveByKey.get(key);
			if (!existing) {
				const [created] = await tx
					.insert(domains)
					.values(newDomainValues(domain, parent))
					.returning();
				if (!created) {
					throw new Error(`Failed to create domain ${domain.host}`);
				}
				continue;
			}
			const patch = domainUpdatePatch(domain, parent);
			if (Object.keys(patch).length > 0) {
				await tx.update(domains).set(patch).where(eq(domains.domainId, existing.domainId));
			}
			liveByKey.delete(key);
		}

		// GitOps semantics: live domains absent from the desired stack are removed.
		for (const leftover of liveByKey.values()) {
			await tx.delete(domains).where(eq(domains.domainId, leftover.domainId));
		}
	});

	if (parent.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, parent.applicationId),
		});
		if (application) {
			await syncApplicationTraefik(application);
		}
	} else if (parent.composeId) {
		await resyncComposeDomains(parent.composeId);
	}
};

const applyApplication = async (
	desired: NonNullable<NixployStack["applications"]>[number],
	environmentId: string,
	live?: LiveStackState["applications"][number],
): Promise<void> => {
	let applicationId: string;
	if (!live) {
		const created = await createApplication({
			name: desired.name,
			description: desired.description ?? null,
			environmentId,
			appName: desired.appName,
		});
		applicationId = created.applicationId;
	} else {
		const existing = await db.query.applications.findFirst({
			where: and(
				eq(applications.environmentId, environmentId),
				eq(applications.name, desired.name),
			),
		});
		if (!existing) {
			throw notFound(`Application "${desired.name}" not found`);
		}
		applicationId = existing.applicationId;
	}

	const patch: Partial<typeof applications.$inferInsert> = {};
	for (const field of APPLICATION_FIELDS) {
		const value = desired[field];
		if (value !== undefined) {
			(patch as Record<string, unknown>)[field] = value;
		}
	}
	if (typeof patch.dockerImage === "string" && patch.dockerImage.length > 0) {
		patch.dockerImage = assertSafeDockerImageRef(patch.dockerImage);
	}
	if (Object.keys(patch).length > 0) {
		await updateApplication(applicationId, patch);
	}

	const liveDomains = await db.query.domains.findMany({
		where: eq(domains.applicationId, applicationId),
	});
	await syncDomains(desired.domains, liveDomains, { applicationId });
};

const applyCompose = async (
	desired: NonNullable<NixployStack["compose"]>[number],
	environmentId: string,
	live?: LiveStackState["compose"][number],
): Promise<void> => {
	let composeId: string;
	let composeRow: typeof compose.$inferSelect;

	if (!live) {
		composeRow = await createCompose({
			name: desired.name,
			description: desired.description ?? null,
			environmentId,
			composeType: desired.composeType ?? "docker-compose",
			sourceType: desired.sourceType ?? "raw",
			appName: desired.appName,
		});
		composeId = composeRow.composeId;
	} else {
		const existing = await db.query.compose.findFirst({
			where: and(eq(compose.environmentId, environmentId), eq(compose.name, desired.name)),
		});
		if (!existing) {
			throw notFound(`Compose service "${desired.name}" not found`);
		}
		composeRow = existing;
		composeId = composeRow.composeId;
	}

	const patch: Partial<typeof compose.$inferInsert> = {};
	for (const field of COMPOSE_FIELDS) {
		const value = desired[field];
		if (value !== undefined) {
			(patch as Record<string, unknown>)[field] = value;
		}
	}
	if (Object.keys(patch).length > 0) {
		composeRow = await updateComposeById(composeId, patch);
	}

	if (desired.composeFile !== undefined && composeRow.sourceType === "raw") {
		if (composeRow.hostPrivileged) {
			throw preconditionFailed(
				`Compose "${desired.name}" is host-privileged; update its compose file as instance admin in the UI (GitOps cannot rewrite docker.sock stacks)`,
			);
		}
		await saveComposeFile(composeRow, desired.composeFile);
	}

	const liveDomains = await db.query.domains.findMany({
		where: eq(domains.composeId, composeId),
	});
	await syncDomains(desired.domains, liveDomains, { composeId });
};

const applyDatabase = async (
	kind: DatabaseServiceKind,
	desired: Record<string, unknown>,
	environmentId: string,
	live?: { name: string; row: Record<string, unknown> },
): Promise<void> => {
	const { module } = databaseDef(kind);

	if (!live) {
		const credentials = DATABASE_KIND_CREDENTIALS[kind];
		const config = DATABASE_CONFIGS[kind];
		const dockerImage = assertSafeDockerImageRef(
			(desired.dockerImage as string | undefined) ?? config.defaultImage,
		);
		await module.insert({
			name: String(desired.name),
			description: (desired.description as string | null | undefined) ?? null,
			environmentId,
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

	const patch: Record<string, unknown> = {};
	for (const field of DATABASE_FIELDS) {
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
		const existing = await module.findByName(environmentId, String(desired.name), tx);
		if (!existing) return;
		await module.updateById(module.rowId(existing), patch, tx);
	});
};

export const planStack = async (
	stack: NixployStack,
	organizationId: string,
	projectId?: string,
): Promise<GitopsPlanResult> => {
	const project = await resolveProjectForStack(organizationId, stack, projectId);
	const { environmentName } = await resolveEnvironmentId(project.projectId, stack);
	const live = await loadLiveStackState(project.projectId, environmentName);
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
	parent?: string,
): GitopsPlanResult["items"][number]["action"] | undefined =>
	plan.items.find(
		(item) =>
			item.kind === kind && item.name === name && (parent ? item.parent === parent : !item.parent),
	)?.action;

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
): Promise<ApplyStackResult> => {
	const project = await resolveProjectForStack(organizationId, stack, projectId);
	const { environmentId, environmentName } = await resolveEnvironmentId(project.projectId, stack);
	const live = await loadLiveStackState(project.projectId, environmentName);
	const plan = buildPlan(stack, live);
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
				if (item.kind === "domain" && item.parent === name) item.error = message;
			}
		}
	};

	for (const app of stack.applications ?? []) {
		if (app.environment !== environmentName) continue;
		const existing = live.applications.find((row) => row.name === app.name);
		const action = planAction(plan, "application", app.name);
		await attempt("application", app.name, async () => {
			if (action !== "noop") {
				await applyApplication(app, environmentId, existing);
				return;
			}
			const application = await db.query.applications.findFirst({
				where: and(eq(applications.environmentId, environmentId), eq(applications.name, app.name)),
			});
			if (application) {
				const liveDomains = await db.query.domains.findMany({
					where: eq(domains.applicationId, application.applicationId),
				});
				await syncDomains(app.domains, liveDomains, {
					applicationId: application.applicationId,
				});
			}
		});
	}

	for (const row of stack.compose ?? []) {
		if (row.environment !== environmentName) continue;
		const existing = live.compose.find((entry) => entry.name === row.name);
		const action = planAction(plan, "compose", row.name);
		await attempt("compose", row.name, async () => {
			if (action !== "noop") {
				await applyCompose(row, environmentId, existing);
				return;
			}
			const composeRow = await db.query.compose.findFirst({
				where: and(eq(compose.environmentId, environmentId), eq(compose.name, row.name)),
			});
			if (composeRow) {
				const liveDomains = await db.query.domains.findMany({
					where: eq(domains.composeId, composeRow.composeId),
				});
				await syncDomains(row.domains, liveDomains, {
					composeId: composeRow.composeId,
				});
			}
		});
	}

	for (const kind of DATABASE_KINDS) {
		for (const dbDesired of stack.databases?.[kind] ?? []) {
			if (dbDesired.environment !== environmentName) continue;
			const existing = live.databases[kind].find((entry) => entry.name === dbDesired.name);
			const action = planAction(plan, kind, dbDesired.name);
			if (action === "noop") continue;
			await attempt(kind, dbDesired.name, () =>
				applyDatabase(kind, dbDesired as Record<string, unknown>, environmentId, existing),
			);
		}
	}

	return {
		...plan,
		applied: plan.items.filter((item) => item.action !== "noop" && !item.error).length,
		errors,
	};
};
