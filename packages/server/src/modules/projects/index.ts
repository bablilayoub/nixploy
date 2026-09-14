import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { certificates, environments, members, projects } from "../../db/schema";
import { bestEffort } from "../../utils/best-effort";
import { deleteApplication } from "../application/service";
import { unregisterBackupsForService } from "../backups/scheduler";
import { deleteCompose } from "../compose/service";
import { removeDatabase } from "../databases/engine";
import { pruneEnvironmentNetwork } from "../deployment/network";
import { forbidden, notFound } from "../errors";
import { unregisterSchedulesForService } from "../schedules";
import {
	DATABASE_DEFS,
	type DatabaseServiceKind,
	SERVICE_DEFS,
	SERVICE_REGISTRY,
	type ServiceKind,
	type ServiceRow,
} from "../services/registry";
import { getCertificatesDir, REMOTE_TRAEFIK_DIR, removeFileOnServer } from "../traefik";
import type { OrgRole } from "./roles";
import { ORG_ROLE_RANK, orgRoleRank } from "./roles";

export * from "./capabilities";
export * from "./env-resolution";
export type { OrgRole } from "./roles";
export { ORG_ROLE_RANK, orgRoleRank } from "./roles";

// ── organization resolution ─────────────────────────────────────────────────

/**
 * Resolve the organization the caller is acting for: the session's active
 * organization when set (membership verified), otherwise the first
 * organization the user is a member of.
 *
 * @throws DomainError FORBIDDEN when the user has no (valid) organization.
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
			throw forbidden("You are not a member of the active organization");
		}
		return activeOrganizationId;
	}
	const firstMembership = await db.query.members.findFirst({
		where: eq(members.userId, userId),
		orderBy: asc(members.createdAt),
	});
	if (!firstMembership) {
		throw forbidden("You are not a member of any organization");
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

/**
 * Require the caller's role in `organizationId` to be at least `minRole`
 * (viewer < member < deployer < admin < owner). Used by write/destructive
 * mutations across tRPC routers.
 * @throws DomainError FORBIDDEN.
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
		throw forbidden(`This action requires the ${minRole} role or higher`);
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
 * @throws DomainError NOT_FOUND / FORBIDDEN.
 */
export async function findProjectById(projectId: string, organizationId: string) {
	const project = await db.query.projects.findFirst({
		where: eq(projects.projectId, projectId),
	});
	if (!project) {
		throw notFound("Project not found");
	}
	if (project.organizationId !== organizationId) {
		throw forbidden("You do not have access to this project");
	}
	return project;
}

/**
 * Fetch an environment (with its project) and verify the parent project
 * belongs to `organizationId`.
 * @throws DomainError NOT_FOUND / FORBIDDEN.
 */
export async function findEnvironmentById(environmentId: string, organizationId: string) {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment) {
		throw notFound("Environment not found");
	}
	if (environment.project.organizationId !== organizationId) {
		throw forbidden("You do not have access to this environment");
	}
	return environment;
}

// ── service listings & counts ───────────────────────────────────────────────

/** All services (applications, compose stacks, databases) of one environment. */
export async function getEnvironmentServices(environmentId: string) {
	const [applicationRows, composeRows, postgresRows, mysqlRows, mariadbRows, mongoRows, redisRows] =
		await Promise.all([
			SERVICE_REGISTRY.application.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.compose.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.postgres.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.mysql.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.mariadb.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.mongo.module.listByEnvironment(environmentId),
			SERVICE_REGISTRY.redis.module.listByEnvironment(environmentId),
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
	/** Health breakdown of the same services — what the dashboard rows scan for. */
	byStatus: ServiceStatusCounts;
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
	byStatus: emptyServiceStatusCounts(),
});

/** Counts key of a service kind (`application` is the only plural one). */
const COUNT_KEY_BY_KIND: Record<
	ServiceKind,
	keyof Omit<EnvironmentServiceCounts, "total" | "byStatus">
> = {
	application: "applications",
	compose: "compose",
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	redis: "redis",
};

/** Per-environment service counts for a batch of environment ids. */
export async function getServiceCountsByEnvironment(
	environmentIds: string[],
): Promise<Map<string, EnvironmentServiceCounts>> {
	const countsByEnvironment = new Map<string, EnvironmentServiceCounts>();
	if (environmentIds.length === 0) {
		return countsByEnvironment;
	}

	const perKind = await Promise.all(
		SERVICE_DEFS.map(async (def) => ({
			key: COUNT_KEY_BY_KIND[def.kind],
			rows: await def.module.countByEnvironment(environmentIds),
		})),
	);

	for (const { key, rows } of perKind) {
		for (const row of rows) {
			const entry = countsByEnvironment.get(row.environmentId) ?? emptyServiceCounts();
			entry[key] += row.value;
			entry.total += row.value;
			entry.byStatus[row.status] += row.value;
			entry.byStatus.total += row.value;
			countsByEnvironment.set(row.environmentId, entry);
		}
	}

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
	const perKind = await Promise.all(
		SERVICE_DEFS.map((def) => def.module.statusCounts(organizationId)),
	);
	return mergeServiceStatusRows(...perKind);
}

// ── cascade deletion ────────────────────────────────────────────────────────

/** Run a teardown step without letting one failed service block the rest. */
const tearDown = (label: string, task: () => Promise<unknown>) =>
	bestEffort(`tear down ${label}`, task, "error");

/**
 * Delete an environment and everything inside it. Every service is torn
 * down through its own delete function — real Swarm services, Traefik
 * configs, data volumes and on-disk state are removed, not just DB rows.
 * Failures on one service are logged and never block the rest (a stopped
 * remote server or missing config dir must not prevent the delete).
 */
export async function deleteEnvironmentCascade(environmentId: string): Promise<void> {
	const services = await getEnvironmentServices(environmentId);

	// Schedules and backups are in-memory node-schedule jobs the DB cascade
	// never reaches. deleteApplication cancels its own; compose and database
	// teardown do not, so theirs are cancelled here before anything is torn
	// down — a job firing mid-delete would exec into a vanishing container.
	for (const composeRow of services.compose) {
		unregisterSchedulesForService({
			composeId: composeRow.composeId,
			appName: composeRow.appName,
		});
		unregisterBackupsForService({
			appName: composeRow.appName,
			composeId: composeRow.composeId,
		});
	}

	await Promise.all(
		services.applications.map((application) =>
			tearDown(`application ${application.appName}`, () => deleteApplication(application)),
		),
	);
	await Promise.all(
		services.compose.map((composeRow) =>
			tearDown(`compose stack ${composeRow.appName}`, () => deleteCompose(composeRow)),
		),
	);

	// `kind` lets removeDatabase verify it is tearing down a managed database
	// service of that engine and not an unrelated swarm service of the same name.
	const databaseIds = new Map<DatabaseServiceKind, string[]>();
	for (const def of DATABASE_DEFS) {
		const rows: Array<ServiceRow<DatabaseServiceKind>> = services[def.kind];
		if (rows.length === 0) continue;
		databaseIds.set(
			def.kind,
			rows.map((row) => def.module.rowId(row)),
		);
		await Promise.all(
			rows.map((row) => {
				unregisterBackupsForService({ appName: row.appName });
				return tearDown(`database ${row.appName}`, () =>
					removeDatabase(row.appName, row.serverId, def.kind, environmentId),
				);
			}),
		);
	}

	// Every service left the environment overlay; drop it before the rows go
	// (it is resolved from the environment row, which the transaction removes).
	await pruneEnvironmentNetwork(environmentId);

	// Row deletions only — the Swarm/Traefik/volume teardown above is
	// best-effort and stays outside, so a DB failure here cannot roll it back.
	await db.transaction(async (tx) => {
		for (const [kind, ids] of databaseIds) {
			await SERVICE_REGISTRY[kind].module.deleteByIds(ids, tx);
		}
		// The environment itself (remaining FK children — domains, mounts... — cascade in the DB).
		await tx.delete(environments).where(eq(environments.environmentId, environmentId));
	});
}

/**
 * Delete a project and everything inside it (every environment, cascaded
 * with {@link deleteEnvironmentCascade}), then the project row itself.
 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
	const environmentList = await db.query.environments.findMany({
		where: eq(environments.projectId, projectId),
	});
	// Each environment commits its own row deletions once its infra is gone;
	// one transaction around every environment would hold locks across minutes
	// of Swarm teardown.
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
	const certRows = await db.query.certificates.findMany({
		where: eq(certificates.organizationId, organizationId),
	});
	for (const cert of certRows) {
		const dir = cert.serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic/certificates` : getCertificatesDir();
		await bestEffort(`remove certificate ${cert.certificateId}.crt`, () =>
			removeFileOnServer(`${dir}/${cert.certificateId}.crt`, cert.serverId),
		);
		await bestEffort(`remove certificate ${cert.certificateId}.key`, () =>
			removeFileOnServer(`${dir}/${cert.certificateId}.key`, cert.serverId),
		);
	}

	const projectList = await db.query.projects.findMany({
		where: eq(projects.organizationId, organizationId),
	});
	for (const project of projectList) {
		await deleteProjectCascade(project.projectId);
	}
}

export * from "./quotas";
