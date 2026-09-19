import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../../db";
import {
	domainMiddlewares,
	domains,
	environments,
	mounts,
	ports,
	redirects,
	registry,
	security,
	servers,
} from "../../db/schema";
import { conflict, notFound } from "../errors";
import { findProjectById, getEnvironmentServices } from "../projects";

/**
 * Everything the exporter and the planner read about one environment, loaded
 * in a fixed number of queries: the service rows, then every child table in
 * one `inArray` each, then the registry and server names the rows reference
 * by id. Both callers used to issue one domain query per service; with five
 * child tables that would have been five round trips per service.
 */

type DomainRow = typeof domains.$inferSelect;
type MiddlewareRow = typeof domainMiddlewares.$inferSelect;
export type DomainWithMiddlewares = DomainRow & { middlewares: MiddlewareRow[] };
export type MountRow = typeof mounts.$inferSelect;
export type PortRow = typeof ports.$inferSelect;
export type RedirectRow = typeof redirects.$inferSelect;
export type SecurityRow = typeof security.$inferSelect;

export interface EnvironmentGraph {
	project: Awaited<ReturnType<typeof findProjectById>>;
	environment: typeof environments.$inferSelect;
	services: Awaited<ReturnType<typeof getEnvironmentServices>>;
	/** Keyed by the owning application/compose id. */
	domainsByParent: Map<string, DomainWithMiddlewares[]>;
	mountsByParent: Map<string, MountRow[]>;
	portsByParent: Map<string, PortRow[]>;
	redirectsByParent: Map<string, RedirectRow[]>;
	securityByParent: Map<string, SecurityRow[]>;
	registryNameById: Map<string, string>;
	serverNameById: Map<string, string>;
}

const groupBy = <T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, T[]> => {
	const map = new Map<string, T[]>();
	for (const row of rows) {
		const id = key(row);
		if (!id) continue;
		const bucket = map.get(id);
		if (bucket) bucket.push(row);
		else map.set(id, [row]);
	}
	return map;
};

export const loadEnvironmentGraph = async (
	projectId: string,
	environmentName: string,
	organizationId: string,
): Promise<EnvironmentGraph> => {
	const project = await findProjectById(projectId, organizationId);
	const environment = await db.query.environments.findFirst({
		where: and(
			eq(environments.projectId, project.projectId),
			eq(environments.name, environmentName),
		),
	});
	if (!environment) {
		throw notFound(`Environment "${environmentName}" not found in this project`);
	}

	const services = await getEnvironmentServices(environment.environmentId);
	const applicationIds = services.applications.map((row) => row.applicationId);
	const composeIds = services.compose.map((row) => row.composeId);
	const parentWhere = (table: { applicationId: AnyPgColumn; composeId: AnyPgColumn }) => {
		const clauses: SQL[] = [];
		if (applicationIds.length > 0) clauses.push(inArray(table.applicationId, applicationIds));
		if (composeIds.length > 0) clauses.push(inArray(table.composeId, composeIds));
		return clauses;
	};
	const anyParent = applicationIds.length + composeIds.length > 0;

	const [domainRows, mountRows, portRows, redirectRows, securityRows, registries, serverRows] =
		await Promise.all([
			anyParent
				? db.query.domains.findMany({
						where: (table, { or }) => or(...parentWhere(table)),
						with: {
							middlewares: { orderBy: [domainMiddlewares.order, domainMiddlewares.createdAt] },
						},
						orderBy: [domains.createdAt],
					})
				: Promise.resolve([] as DomainWithMiddlewares[]),
			anyParent
				? db.query.mounts.findMany({
						where: (table, { or }) => or(...parentWhere(table)),
						orderBy: [mounts.createdAt],
					})
				: Promise.resolve([] as MountRow[]),
			applicationIds.length > 0
				? db.query.ports.findMany({
						where: inArray(ports.applicationId, applicationIds),
						orderBy: [ports.createdAt],
					})
				: Promise.resolve([] as PortRow[]),
			anyParent
				? db.query.redirects.findMany({
						where: (table, { or }) => or(...parentWhere(table)),
						orderBy: [redirects.createdAt],
					})
				: Promise.resolve([] as RedirectRow[]),
			anyParent
				? db.query.security.findMany({
						where: (table, { or }) => or(...parentWhere(table)),
						orderBy: [security.createdAt],
					})
				: Promise.resolve([] as SecurityRow[]),
			db.query.registry.findMany({
				where: eq(registry.organizationId, organizationId),
				columns: { registryId: true, registryName: true },
			}),
			db.query.servers.findMany({
				where: eq(servers.organizationId, organizationId),
				columns: { serverId: true, name: true },
			}),
		]);

	// Preview domains belong to `<app>-pr-<n>`, not to the parent's desired state.
	const parentDomains = domainRows.filter((row) => !row.previewDeploymentId);
	const parentOf = (row: { applicationId: string | null; composeId: string | null }) =>
		row.applicationId ?? row.composeId;

	return {
		project,
		environment,
		services,
		domainsByParent: groupBy(parentDomains, parentOf),
		mountsByParent: groupBy(mountRows, parentOf),
		portsByParent: groupBy(portRows, (row) => row.applicationId),
		redirectsByParent: groupBy(redirectRows, parentOf),
		securityByParent: groupBy(securityRows, parentOf),
		registryNameById: new Map(registries.map((row) => [row.registryId, row.registryName])),
		serverNameById: new Map(serverRows.map((row) => [row.serverId, row.name])),
	};
};

/**
 * A registry named in a manifest, resolved inside the organization. Names
 * are not unique in the table, so two registries with one name is an error
 * the file cannot resolve — the operator renames one first.
 */
export const resolveRegistryByName = async (
	organizationId: string,
	name: string,
): Promise<typeof registry.$inferSelect> => {
	const rows = await db.query.registry.findMany({
		where: and(eq(registry.organizationId, organizationId), eq(registry.registryName, name)),
	});
	const [row, second] = rows;
	if (!row) throw notFound(`Registry "${name}" not found in this organization`);
	if (second) throw conflict(`Registry name "${name}" is ambiguous — rename one of them first`);
	return row;
};

export const resolveServerByName = async (
	organizationId: string,
	name: string,
): Promise<typeof servers.$inferSelect> => {
	const rows = await db.query.servers.findMany({
		where: and(eq(servers.organizationId, organizationId), eq(servers.name, name)),
	});
	const [row, second] = rows;
	if (!row) throw notFound(`Server "${name}" not found in this organization`);
	if (second) throw conflict(`Server name "${name}" is ambiguous — rename one of them first`);
	return row;
};
