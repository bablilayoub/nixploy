import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	domains,
	environments,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "../../db/schema";
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
import { getEnvironmentServices } from "../projects";
import { randomPassword, resolveEnvironmentId, resolveProjectForStack } from "./export";
import { buildPlan, type GitopsPlanResult, type LiveStackState } from "./plan";
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
		throw new Error(`Environment "${environmentName}" not found`);
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

	const pick = (row: Record<string, unknown>, fields: readonly string[]) => {
		const result: Record<string, unknown> = {};
		for (const field of fields) {
			result[field] = row[field] ?? null;
		}
		return result;
	};

	return {
		projectId,
		environmentName,
		applications: services.applications.map((row) => ({
			name: row.name,
			appName: row.appName,
			row: pick(row as unknown as Record<string, unknown>, APPLICATION_FIELDS),
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
				...pick(row as unknown as Record<string, unknown>, COMPOSE_FIELDS),
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
			postgres: services.postgres.map((row) => ({
				name: row.name,
				row: pick(row as unknown as Record<string, unknown>, DATABASE_FIELDS),
			})),
			mysql: services.mysql.map((row) => ({
				name: row.name,
				row: pick(row as unknown as Record<string, unknown>, DATABASE_FIELDS),
			})),
			mariadb: services.mariadb.map((row) => ({
				name: row.name,
				row: pick(row as unknown as Record<string, unknown>, DATABASE_FIELDS),
			})),
			mongo: services.mongo.map((row) => ({
				name: row.name,
				row: pick(row as unknown as Record<string, unknown>, DATABASE_FIELDS),
			})),
			redis: services.redis.map((row) => ({
				name: row.name,
				row: pick(row as unknown as Record<string, unknown>, DATABASE_FIELDS),
			})),
		},
	};
};

const createDomain = async (
	domain: GitopsDomain,
	parent: { applicationId?: string; composeId?: string },
): Promise<void> => {
	const host = assertTraefikHost(domain.host);
	const path = assertTraefikPath(domain.path ?? "/") ?? "/";
	const serviceName = parent.composeId ? (domain.serviceName ?? null) : null;
	if (serviceName) {
		assertComposeServiceName(serviceName);
	}
	const certificateType = domain.certificateType ?? "none";
	const values = {
		host,
		path,
		port: domain.port ?? null,
		https: domain.https ?? false,
		certificateType,
		certificateId: null,
		serviceName,
		domainType: parent.applicationId ? ("application" as const) : ("compose" as const),
		uniqueConfigKey: randomBytes(6).toString("hex"),
		applicationId: parent.applicationId ?? null,
		composeId: parent.composeId ?? null,
	};

	const [created] = await db.insert(domains).values(values).returning();
	if (!created) {
		throw new Error(`Failed to create domain ${domain.host}`);
	}

	if (parent.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, parent.applicationId),
		});
		if (application) {
			await syncApplicationTraefik(application);
		}
		return;
	}
	if (parent.composeId) {
		await resyncComposeDomains(parent.composeId);
	}
};

const syncDomains = async (
	desired: GitopsDomain[] | undefined,
	liveDomains: Array<{ domainId: string; host: string; path: string | null; port: number | null }>,
	parent: { applicationId?: string; composeId?: string },
): Promise<void> => {
	const liveByKey = new Map(
		liveDomains.map((row) => [`${row.host}|${row.path ?? "/"}|${row.port ?? ""}`, row]),
	);

	for (const domain of desired ?? []) {
		const key = domainKey(domain);
		const existing = liveByKey.get(key);
		if (!existing) {
			await createDomain(domain, parent);
			continue;
		}
		const certificateType = domain.certificateType ?? "none";
		const serviceName = parent.composeId ? (domain.serviceName ?? null) : null;
		if (serviceName) {
			assertComposeServiceName(serviceName);
		}
		await db
			.update(domains)
			.set({
				https: domain.https ?? false,
				certificateType,
				port: domain.port ?? null,
				serviceName,
			})
			.where(eq(domains.domainId, existing.domainId));
		liveByKey.delete(key);
	}

	// GitOps semantics: live domains absent from the desired stack are removed.
	for (const leftover of liveByKey.values()) {
		await db.delete(domains).where(eq(domains.domainId, leftover.domainId));
	}

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
			throw new Error(`Application "${desired.name}" not found`);
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
			throw new Error(`Compose service "${desired.name}" not found`);
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
			throw new Error(
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

type DatabaseKind = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

const TABLE_BY_KIND = { postgres, mysql, mariadb, mongo, redis } as const;

const applyDatabase = async (
	kind: DatabaseKind,
	desired: Record<string, unknown>,
	environmentId: string,
	live?: { name: string; row: Record<string, unknown> },
): Promise<void> => {
	if (!live) {
		const password = randomPassword();
		const rootPassword = randomPassword();
		const config = DATABASE_CONFIGS[kind];
		const dockerImage = assertSafeDockerImageRef(
			(desired.dockerImage as string | undefined) ?? config.defaultImage,
		);
		const base = {
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
		};

		if (kind === "postgres") {
			await db.insert(postgres).values({
				...base,
				databaseName: (desired.databaseName as string | undefined) ?? "postgres",
				databaseUser: (desired.databaseUser as string | undefined) ?? "postgres",
				databasePassword: password,
			});
			return;
		}
		if (kind === "mysql") {
			await db.insert(mysql).values({
				...base,
				databaseName: (desired.databaseName as string | undefined) ?? "mysql",
				databaseUser: (desired.databaseUser as string | undefined) ?? "mysql",
				databasePassword: password,
				databaseRootPassword: rootPassword,
			});
			return;
		}
		if (kind === "mariadb") {
			await db.insert(mariadb).values({
				...base,
				databaseName: (desired.databaseName as string | undefined) ?? "mariadb",
				databaseUser: (desired.databaseUser as string | undefined) ?? "mariadb",
				databasePassword: password,
				databaseRootPassword: rootPassword,
			});
			return;
		}
		if (kind === "mongo") {
			await db.insert(mongo).values({
				...base,
				databaseUser: (desired.databaseUser as string | undefined) ?? "mongo",
				databasePassword: password,
			});
			return;
		}
		await db.insert(redis).values({
			...base,
			databasePassword: password,
		});
		return;
	}

	// biome-ignore lint/suspicious/noExplicitAny: drizzle table generics differ per kind
	const table = TABLE_BY_KIND[kind] as any;
	const idColumn = `${kind}Id`;
	const existing = (
		await db
			.select()
			.from(table)
			.where(and(eq(table.environmentId, environmentId), eq(table.name, String(desired.name))))
			.limit(1)
	)[0] as Record<string, unknown> | undefined;
	if (!existing) return;

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
	if (Object.keys(patch).length > 0) {
		await db.update(table).set(patch).where(eq(table[idColumn], existing[idColumn]));
	}
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

/** Apply a desired stack to the live project/environment (no deploy engine). */
export const applyStack = async (
	stack: NixployStack,
	organizationId: string,
	projectId?: string,
): Promise<ApplyStackResult> => {
	const project = await resolveProjectForStack(organizationId, stack, projectId);
	const { environmentId, environmentName } = await resolveEnvironmentId(project.projectId, stack);
	const live = await loadLiveStackState(project.projectId, environmentName);
	const plan = buildPlan(stack, live);

	for (const app of stack.applications ?? []) {
		if (app.environment !== environmentName) continue;
		const existing = live.applications.find((row) => row.name === app.name);
		const action = planAction(plan, "application", app.name);
		if (action !== "noop") {
			await applyApplication(app, environmentId, existing);
			continue;
		}
		const application = await db.query.applications.findFirst({
			where: and(eq(applications.environmentId, environmentId), eq(applications.name, app.name)),
		});
		if (application) {
			const liveDomains = await db.query.domains.findMany({
				where: eq(domains.applicationId, application.applicationId),
			});
			await syncDomains(app.domains, liveDomains, { applicationId: application.applicationId });
		}
	}

	for (const row of stack.compose ?? []) {
		if (row.environment !== environmentName) continue;
		const existing = live.compose.find((entry) => entry.name === row.name);
		const action = planAction(plan, "compose", row.name);
		if (action !== "noop") {
			await applyCompose(row, environmentId, existing);
			continue;
		}
		const composeRow = await db.query.compose.findFirst({
			where: and(eq(compose.environmentId, environmentId), eq(compose.name, row.name)),
		});
		if (composeRow) {
			const liveDomains = await db.query.domains.findMany({
				where: eq(domains.composeId, composeRow.composeId),
			});
			await syncDomains(row.domains, liveDomains, { composeId: composeRow.composeId });
		}
	}

	const databaseKinds: DatabaseKind[] = ["postgres", "mysql", "mariadb", "mongo", "redis"];
	for (const kind of databaseKinds) {
		for (const dbDesired of stack.databases?.[kind] ?? []) {
			if (dbDesired.environment !== environmentName) continue;
			const existing = live.databases[kind].find((entry) => entry.name === dbDesired.name);
			const action = planAction(plan, kind, dbDesired.name);
			if (action === "noop") continue;
			await applyDatabase(kind, dbDesired as Record<string, unknown>, environmentId, existing);
		}
	}

	return {
		...plan,
		applied: plan.items.filter((item) => item.action !== "noop").length,
	};
};
