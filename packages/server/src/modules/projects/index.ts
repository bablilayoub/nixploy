import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	environments,
	mariadb,
	members,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "../../db/schema";
import { deleteApplication } from "../application/service";
import { deleteCompose } from "../compose/service";
import { removeDatabase } from "../databases/engine";

export * from "./env-resolution";

// ── organization resolution ─────────────────────────────────────────────────

/**
 * Resolve the organization the caller is acting for: the session's active
 * organization when set (membership verified), otherwise the first
 * organization the user is a member of.
 *
 * @throws TRPCError FORBIDDEN when the user has no (valid) organization.
 */
export async function resolveCallerOrganizationId(
	userId: string,
	activeOrganizationId?: string | null,
): Promise<string> {
	if (activeOrganizationId) {
		const membership = await db.query.members.findFirst({
			where: and(eq(members.userId, userId), eq(members.organizationId, activeOrganizationId)),
		});
		if (!membership) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You are not a member of the active organization",
			});
		}
		return activeOrganizationId;
	}
	const firstMembership = await db.query.members.findFirst({
		where: eq(members.userId, userId),
		orderBy: asc(members.createdAt),
	});
	if (!firstMembership) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not a member of any organization",
		});
	}
	return firstMembership.organizationId;
}

/**
 * Whether the user belongs to any organization. Used by the dashboard shell
 * to render a create-organization screen instead of letting every org-scoped
 * query fail with FORBIDDEN.
 */
export async function userHasOrganization(userId: string): Promise<boolean> {
	const membership = await db.query.members.findFirst({
		where: eq(members.userId, userId),
	});
	return Boolean(membership);
}

// ── role checks ─────────────────────────────────────────────────────────────

export type OrgRole = "viewer" | "member" | "deployer" | "admin" | "owner";

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
	viewer: 0,
	member: 1,
	deployer: 2,
	admin: 3,
	owner: 4,
};

/** Rank for a stored member role string; unknown values fall back to viewer. */
export function orgRoleRank(role: string): number {
	const parts = role
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	let max = ORG_ROLE_RANK.viewer;
	let matched = false;
	for (const part of parts) {
		const rank = ORG_ROLE_RANK[part as OrgRole];
		if (rank !== undefined) {
			matched = true;
			if (rank > max) max = rank;
		}
	}
	// Unknown custom roles: treat as viewer (never elevate).
	return matched ? max : ORG_ROLE_RANK.viewer;
}

/**
 * Require the caller's role in `organizationId` to be at least `minRole`
 * (viewer < member < deployer < admin < owner). Used by write/destructive
 * mutations across tRPC routers.
 * @throws TRPCError FORBIDDEN.
 */
export async function assertOrgRole(
	userId: string,
	organizationId: string,
	minRole: OrgRole,
): Promise<void> {
	const membership = await db.query.members.findFirst({
		where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)),
	});
	if (!membership || orgRoleRank(membership.role) < ORG_ROLE_RANK[minRole]) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `This action requires the ${minRole} role or higher`,
		});
	}
}

/** True when the caller meets `minRole` in the org (no throw). */
export async function hasOrgRole(
	userId: string,
	organizationId: string,
	minRole: OrgRole,
): Promise<boolean> {
	const membership = await db.query.members.findFirst({
		where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)),
	});
	return Boolean(membership && orgRoleRank(membership.role) >= ORG_ROLE_RANK[minRole]);
}

// ── scoped lookups ──────────────────────────────────────────────────────────

/**
 * Fetch a project and verify it belongs to `organizationId`.
 * @throws TRPCError NOT_FOUND / FORBIDDEN.
 */
export async function findProjectById(projectId: string, organizationId: string) {
	const project = await db.query.projects.findFirst({
		where: eq(projects.projectId, projectId),
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
	}
	if (project.organizationId !== organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You do not have access to this project",
		});
	}
	return project;
}

/**
 * Fetch an environment (with its project) and verify the parent project
 * belongs to `organizationId`.
 * @throws TRPCError NOT_FOUND / FORBIDDEN.
 */
export async function findEnvironmentById(environmentId: string, organizationId: string) {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
	}
	if (environment.project.organizationId !== organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You do not have access to this environment",
		});
	}
	return environment;
}

// ── service listings & counts ───────────────────────────────────────────────

/** All services (applications, compose stacks, databases) of one environment. */
export async function getEnvironmentServices(environmentId: string) {
	const [applicationRows, composeRows, postgresRows, mysqlRows, mariadbRows, mongoRows, redisRows] =
		await Promise.all([
			db.select().from(applications).where(eq(applications.environmentId, environmentId)),
			db.select().from(compose).where(eq(compose.environmentId, environmentId)),
			db.select().from(postgres).where(eq(postgres.environmentId, environmentId)),
			db.select().from(mysql).where(eq(mysql.environmentId, environmentId)),
			db.select().from(mariadb).where(eq(mariadb.environmentId, environmentId)),
			db.select().from(mongo).where(eq(mongo.environmentId, environmentId)),
			db.select().from(redis).where(eq(redis.environmentId, environmentId)),
		]);
	return {
		applications: applicationRows,
		compose: composeRows,
		postgres: postgresRows,
		mysql: mysqlRows,
		mariadb: mariadbRows,
		mongo: mongoRows,
		redis: redisRows,
	};
}

export interface EnvironmentServiceCounts {
	applications: number;
	compose: number;
	postgres: number;
	mysql: number;
	mariadb: number;
	mongo: number;
	redis: number;
	total: number;
}

export const emptyServiceCounts = (): EnvironmentServiceCounts => ({
	applications: 0,
	compose: 0,
	postgres: 0,
	mysql: 0,
	mariadb: 0,
	mongo: 0,
	redis: 0,
	total: 0,
});

/** Per-environment service counts for a batch of environment ids. */
export async function getServiceCountsByEnvironment(
	environmentIds: string[],
): Promise<Map<string, EnvironmentServiceCounts>> {
	const countsByEnvironment = new Map<string, EnvironmentServiceCounts>();
	if (environmentIds.length === 0) {
		return countsByEnvironment;
	}

	const [
		applicationCounts,
		composeCounts,
		postgresCounts,
		mysqlCounts,
		mariadbCounts,
		mongoCounts,
		redisCounts,
	] = await Promise.all([
		db
			.select({ environmentId: applications.environmentId, value: count() })
			.from(applications)
			.where(inArray(applications.environmentId, environmentIds))
			.groupBy(applications.environmentId),
		db
			.select({ environmentId: compose.environmentId, value: count() })
			.from(compose)
			.where(inArray(compose.environmentId, environmentIds))
			.groupBy(compose.environmentId),
		db
			.select({ environmentId: postgres.environmentId, value: count() })
			.from(postgres)
			.where(inArray(postgres.environmentId, environmentIds))
			.groupBy(postgres.environmentId),
		db
			.select({ environmentId: mysql.environmentId, value: count() })
			.from(mysql)
			.where(inArray(mysql.environmentId, environmentIds))
			.groupBy(mysql.environmentId),
		db
			.select({ environmentId: mariadb.environmentId, value: count() })
			.from(mariadb)
			.where(inArray(mariadb.environmentId, environmentIds))
			.groupBy(mariadb.environmentId),
		db
			.select({ environmentId: mongo.environmentId, value: count() })
			.from(mongo)
			.where(inArray(mongo.environmentId, environmentIds))
			.groupBy(mongo.environmentId),
		db
			.select({ environmentId: redis.environmentId, value: count() })
			.from(redis)
			.where(inArray(redis.environmentId, environmentIds))
			.groupBy(redis.environmentId),
	]);

	const apply = (
		rows: Array<{ environmentId: string; value: number }>,
		key: keyof Omit<EnvironmentServiceCounts, "total">,
	) => {
		for (const row of rows) {
			const entry = countsByEnvironment.get(row.environmentId) ?? emptyServiceCounts();
			entry[key] = row.value;
			entry.total += row.value;
			countsByEnvironment.set(row.environmentId, entry);
		}
	};

	apply(applicationCounts, "applications");
	apply(composeCounts, "compose");
	apply(postgresCounts, "postgres");
	apply(mysqlCounts, "mysql");
	apply(mariadbCounts, "mariadb");
	apply(mongoCounts, "mongo");
	apply(redisCounts, "redis");

	return countsByEnvironment;
}

// ── organization overview ───────────────────────────────────────────────────

export interface ServiceStatusCounts {
	idle: number;
	running: number;
	done: number;
	error: number;
	total: number;
}

export const emptyServiceStatusCounts = (): ServiceStatusCounts => ({
	idle: 0,
	running: 0,
	done: 0,
	error: 0,
	total: 0,
});

type ServiceStatus = keyof Omit<ServiceStatusCounts, "total">;

/** Merge per-table (status, count) rows into one status-counts object. */
export function mergeServiceStatusRows(
	...rowsByTable: Array<Array<{ status: ServiceStatus; value: number }>>
): ServiceStatusCounts {
	const counts = emptyServiceStatusCounts();
	for (const rows of rowsByTable) {
		for (const row of rows) {
			counts[row.status] += row.value;
			counts.total += row.value;
		}
	}
	return counts;
}

/** Status counts of every service across the whole organization. */
export async function getOrganizationServiceStatusCounts(
	organizationId: string,
): Promise<ServiceStatusCounts> {
	const [applicationRows, composeRows, postgresRows, mysqlRows, mariadbRows, mongoRows, redisRows] =
		await Promise.all([
			db
				.select({ status: applications.status, value: count() })
				.from(applications)
				.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(applications.status),
			db
				.select({ status: compose.status, value: count() })
				.from(compose)
				.innerJoin(environments, eq(compose.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(compose.status),
			db
				.select({ status: postgres.status, value: count() })
				.from(postgres)
				.innerJoin(environments, eq(postgres.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(postgres.status),
			db
				.select({ status: mysql.status, value: count() })
				.from(mysql)
				.innerJoin(environments, eq(mysql.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(mysql.status),
			db
				.select({ status: mariadb.status, value: count() })
				.from(mariadb)
				.innerJoin(environments, eq(mariadb.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(mariadb.status),
			db
				.select({ status: mongo.status, value: count() })
				.from(mongo)
				.innerJoin(environments, eq(mongo.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(mongo.status),
			db
				.select({ status: redis.status, value: count() })
				.from(redis)
				.innerJoin(environments, eq(redis.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(redis.status),
		]);

	return mergeServiceStatusRows(
		applicationRows,
		composeRows,
		postgresRows,
		mysqlRows,
		mariadbRows,
		mongoRows,
		redisRows,
	);
}

// ── cascade deletion ────────────────────────────────────────────────────────

/** Run a teardown step without letting one failed service block the rest. */
async function bestEffort(label: string, task: () => Promise<unknown>): Promise<void> {
	try {
		await task();
	} catch (error) {
		console.error(`Failed to tear down ${label}:`, error instanceof Error ? error.message : error);
	}
}

/**
 * Delete an environment and everything inside it. Every service is torn
 * down through its own delete function — real Swarm services, Traefik
 * configs, data volumes and on-disk state are removed, not just DB rows.
 * Failures on one service are logged and never block the rest (a stopped
 * remote server or missing config dir must not prevent the delete).
 */
export async function deleteEnvironmentCascade(environmentId: string): Promise<void> {
	const services = await getEnvironmentServices(environmentId);

	await Promise.all(
		services.applications.map((application) =>
			bestEffort(`application ${application.appName}`, () => deleteApplication(application)),
		),
	);
	await Promise.all(
		services.compose.map((composeRow) =>
			bestEffort(`compose stack ${composeRow.appName}`, () => deleteCompose(composeRow)),
		),
	);

	const removeRows = (rows: Array<{ appName: string; serverId: string | null }>) =>
		Promise.all(
			rows.map((row) =>
				bestEffort(`database ${row.appName}`, () => removeDatabase(row.appName, row.serverId)),
			),
		);

	if (services.postgres.length > 0) {
		await removeRows(services.postgres);
		await db.delete(postgres).where(
			inArray(
				postgres.postgresId,
				services.postgres.map((row) => row.postgresId),
			),
		);
	}
	if (services.mysql.length > 0) {
		await removeRows(services.mysql);
		await db.delete(mysql).where(
			inArray(
				mysql.mysqlId,
				services.mysql.map((row) => row.mysqlId),
			),
		);
	}
	if (services.mariadb.length > 0) {
		await removeRows(services.mariadb);
		await db.delete(mariadb).where(
			inArray(
				mariadb.mariadbId,
				services.mariadb.map((row) => row.mariadbId),
			),
		);
	}
	if (services.mongo.length > 0) {
		await removeRows(services.mongo);
		await db.delete(mongo).where(
			inArray(
				mongo.mongoId,
				services.mongo.map((row) => row.mongoId),
			),
		);
	}
	if (services.redis.length > 0) {
		await removeRows(services.redis);
		await db.delete(redis).where(
			inArray(
				redis.redisId,
				services.redis.map((row) => row.redisId),
			),
		);
	}

	// The environment itself (remaining FK children — domains, mounts... — cascade in the DB).
	await db.delete(environments).where(eq(environments.environmentId, environmentId));
}

/**
 * Delete a project and everything inside it (every environment, cascaded
 * with {@link deleteEnvironmentCascade}), then the project row itself.
 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
	const environmentList = await db.query.environments.findMany({
		where: eq(environments.projectId, projectId),
	});
	for (const environment of environmentList) {
		await deleteEnvironmentCascade(environment.environmentId);
	}
	await db.delete(projects).where(eq(projects.projectId, projectId));
}

/**
 * Delete every project (and everything inside them) belonging to an
 * organization. Used before the organization row itself is removed — real
 * infra must be torn down while the service rows (appName, serverId) still
 * exist, since Postgres FK cascades only ever remove rows, never running
 * containers, volumes or files on disk.
 */
export async function deleteOrganizationCascade(organizationId: string): Promise<void> {
	const projectList = await db.query.projects.findMany({
		where: eq(projects.organizationId, organizationId),
	});
	for (const project of projectList) {
		await deleteProjectCascade(project.projectId);
	}
}

export * from "./quotas";
