import { and, count, desc, eq, gte, type SQL, sql } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, environments, projects } from "../../db/schema";
import { assertApplicationAccess } from "../application";
import { findComposeForOrg } from "../compose/service";
import { findProjectById } from "../projects";

/**
 * Read-side deployment queries for the organization-wide deployments
 * overview. Writes (queue/cancel) live in sibling files under
 * `modules/deployment`; this module only lists and aggregates, always scoped
 * to the caller's organization via the service → environment → project
 * tenancy chain.
 */

export type DeploymentRow = typeof deployments.$inferSelect;

export interface DeploymentListItem extends DeploymentRow {
	service: {
		type: "application" | "compose";
		name: string | null;
		appName: string | null;
	};
	environment: {
		environmentId: string;
		name: string;
	};
	project: {
		projectId: string;
		name: string;
	};
}

export interface DeploymentListResult {
	deployments: DeploymentListItem[];
	/** Opaque cursor for the next page; null when there are no more rows. */
	nextCursor: string | null;
}

export interface DeploymentStats {
	queued: number;
	running: number;
	done: number;
	error: number;
	cancelled: number;
	total: number;
}

// ── shared query plumbing ───────────────────────────────────────────────────

/**
 * Join each deployment to its owning service (application or compose),
 * environment, and project. The inner joins are safe: deployments cascade on
 * service deletion, so every row has a full tenancy chain.
 */
function baseDeploymentQuery() {
	return db
		.select({
			deployment: deployments,
			serviceType: sql<
				"application" | "compose"
			>`case when ${deployments.applicationId} is not null then 'application' else 'compose' end`,
			serviceName: sql<string | null>`coalesce(${applications.name}, ${compose.name})`,
			serviceAppName: sql<string | null>`coalesce(${applications.appName}, ${compose.appName})`,
			environmentId: environments.environmentId,
			environmentName: environments.name,
			projectId: projects.projectId,
			projectName: projects.name,
		})
		.from(deployments)
		.leftJoin(applications, eq(deployments.applicationId, applications.applicationId))
		.leftJoin(compose, eq(deployments.composeId, compose.composeId))
		.innerJoin(
			environments,
			sql`${environments.environmentId} = coalesce(${applications.environmentId}, ${compose.environmentId})`,
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId));
}

type DeploymentQueryRow = Awaited<ReturnType<typeof baseDeploymentQuery>>[number];

function toDeploymentListItem(row: DeploymentQueryRow): DeploymentListItem {
	return {
		...row.deployment,
		service: {
			type: row.serviceType,
			name: row.serviceName,
			appName: row.serviceAppName,
		},
		environment: {
			environmentId: row.environmentId,
			name: row.environmentName,
		},
		project: {
			projectId: row.projectId,
			name: row.projectName,
		},
	};
}

const CURSOR_SEPARATOR = "~";

/** Cursor is `<createdAt ISO>~<deploymentId>` of the last row of a page. */
function encodeCursor(deployment: DeploymentRow): string {
	return `${deployment.createdAt.toISOString()}${CURSOR_SEPARATOR}${deployment.deploymentId}`;
}

/** Keyset condition: rows strictly older than the cursor row. */
function cursorCondition(cursor: string | null | undefined): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	const separatorIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
	if (separatorIndex === -1) {
		return undefined;
	}
	const createdAt = new Date(cursor.slice(0, separatorIndex));
	const deploymentId = cursor.slice(separatorIndex + 1);
	if (Number.isNaN(createdAt.getTime()) || !deploymentId) {
		return undefined;
	}
	return sql`(${deployments.createdAt}, ${deployments.deploymentId}) < (${createdAt}, ${deploymentId})`;
}

async function queryDeployments(
	where: SQL | undefined,
	options: { limit: number; cursor?: string | null },
): Promise<DeploymentListResult> {
	const conditions = [where, cursorCondition(options.cursor)].filter(
		(condition): condition is SQL => condition !== undefined,
	);
	const rows = await baseDeploymentQuery()
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(deployments.createdAt), desc(deployments.deploymentId))
		.limit(options.limit + 1);

	const page = rows.slice(0, options.limit).map(toDeploymentListItem);
	const last = page.at(-1);
	return {
		deployments: page,
		nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
	};
}

// ── public read API ─────────────────────────────────────────────────────────

/** Deployments of every service in one project, newest first (keyset-paginated). */
export async function listDeploymentsByProject(
	projectId: string,
	organizationId: string,
	options: { limit: number; cursor?: string | null },
): Promise<DeploymentListResult> {
	await findProjectById(projectId, organizationId);
	return queryDeployments(
		and(eq(projects.projectId, projectId), eq(deployments.isPreview, false)),
		options,
	);
}

/** Deployments of one application, newest first. */
export async function listDeploymentsByApplication(
	applicationId: string,
	organizationId: string,
	options: { limit: number; cursor?: string | null },
): Promise<DeploymentListResult> {
	await assertApplicationAccess(applicationId, organizationId);
	return queryDeployments(
		and(eq(deployments.applicationId, applicationId), eq(deployments.isPreview, false)),
		options,
	);
}

/** Deployments of one compose service, newest first. */
export async function listDeploymentsByCompose(
	composeId: string,
	organizationId: string,
	options: { limit: number; cursor?: string | null },
): Promise<DeploymentListResult> {
	await findComposeForOrg(composeId, organizationId);
	return queryDeployments(
		and(eq(deployments.composeId, composeId), eq(deployments.isPreview, false)),
		options,
	);
}

/** Most recent deployments across the whole organization. */
export async function listRecentDeployments(
	organizationId: string,
	options: { limit: number; cursor?: string | null },
): Promise<DeploymentListResult> {
	return queryDeployments(
		and(eq(projects.organizationId, organizationId), eq(deployments.isPreview, false)),
		options,
	);
}

/** Deployment counts by status for one project (dashboard widget). */
export async function getDeploymentStatsByProject(
	projectId: string,
	organizationId: string,
): Promise<DeploymentStats> {
	await findProjectById(projectId, organizationId);
	const rows = await db
		.select({ status: deployments.status, value: count() })
		.from(deployments)
		.leftJoin(applications, eq(deployments.applicationId, applications.applicationId))
		.leftJoin(compose, eq(deployments.composeId, compose.composeId))
		.innerJoin(
			environments,
			sql`${environments.environmentId} = coalesce(${applications.environmentId}, ${compose.environmentId})`,
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(and(eq(projects.projectId, projectId), eq(deployments.isPreview, false)))
		.groupBy(deployments.status);

	return mergeDeploymentStatusRows(rows);
}

/** Deployment counts by status across the organization since a given time. */
export async function getDeploymentStatsSince(
	organizationId: string,
	since: Date,
): Promise<DeploymentStats> {
	const rows = await db
		.select({ status: deployments.status, value: count() })
		.from(deployments)
		.leftJoin(applications, eq(deployments.applicationId, applications.applicationId))
		.leftJoin(compose, eq(deployments.composeId, compose.composeId))
		.innerJoin(
			environments,
			sql`${environments.environmentId} = coalesce(${applications.environmentId}, ${compose.environmentId})`,
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(projects.organizationId, organizationId),
				eq(deployments.isPreview, false),
				gte(deployments.createdAt, since),
			),
		)
		.groupBy(deployments.status);

	return mergeDeploymentStatusRows(rows);
}

/** Merge (status, count) rows into a zero-initialized stats object. */
export function mergeDeploymentStatusRows(
	rows: Array<{ status: DeploymentRow["status"]; value: number }>,
): DeploymentStats {
	const stats: DeploymentStats = {
		queued: 0,
		running: 0,
		done: 0,
		error: 0,
		cancelled: 0,
		total: 0,
	};
	for (const row of rows) {
		stats[row.status] += row.value;
		stats.total += row.value;
	}
	return stats;
}

/** Per-day deployment counts (done/error/total) for the last `days` days, org-scoped. */
export async function getDeploymentDailyCounts(
	organizationId: string,
	days: number,
): Promise<{ date: string; done: number; error: number; total: number }[]> {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const rows = await db
		.select({
			day: sql<string>`to_char(date_trunc('day', ${deployments.createdAt}), 'YYYY-MM-DD')`,
			status: deployments.status,
			value: count(),
		})
		.from(deployments)
		.leftJoin(applications, eq(deployments.applicationId, applications.applicationId))
		.leftJoin(compose, eq(deployments.composeId, compose.composeId))
		.innerJoin(
			environments,
			sql`${environments.environmentId} = coalesce(${applications.environmentId}, ${compose.environmentId})`,
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(projects.organizationId, organizationId),
				eq(deployments.isPreview, false),
				gte(deployments.createdAt, since),
			),
		)
		.groupBy(sql`date_trunc('day', ${deployments.createdAt})`, deployments.status);

	const byDay = new Map<string, { done: number; error: number; total: number }>();
	for (const row of rows) {
		const entry = byDay.get(row.day) ?? { done: 0, error: 0, total: 0 };
		entry.total += row.value;
		if (row.status === "done") entry.done += row.value;
		if (row.status === "error") entry.error += row.value;
		byDay.set(row.day, entry);
	}

	// Fill gaps so the chart has a point for every day in the window.
	const result: { date: string; done: number; error: number; total: number }[] = [];
	for (let offset = days - 1; offset >= 0; offset--) {
		const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
		const key = date.toISOString().slice(0, 10);
		const entry = byDay.get(key) ?? { done: 0, error: 0, total: 0 };
		result.push({ date: key, ...entry });
	}
	return result;
}
