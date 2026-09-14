import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { type DbExecutor, db } from "../../db";
import {
	applications,
	applicationTags,
	backups,
	compose,
	composeTags,
	environments,
	mariadb,
	mariadbTags,
	mongo,
	mongoTags,
	mysql,
	mysqlTags,
	postgres,
	postgresTags,
	projects,
	redis,
	redisTags,
	serviceType,
	tags,
} from "../../db/schema";
import {
	DATABASE_KINDS,
	type DatabaseServiceKind,
	isDatabaseServiceKind,
	SERVICE_KIND_LABELS,
	SERVICE_KINDS,
	type ServiceIdField,
	type ServiceKind,
	serviceIdField,
} from "./kinds";

export * from "./kinds";

/**
 * One place that knows how a service kind maps onto the database: its table,
 * primary key, tag join table, backup FK and the handful of row reads/writes
 * the kind-agnostic call sites need.
 *
 * Before this existed the same seven-way switch was written out in eight
 * files (tenancy lookups, tags, project counts + cascade delete, the
 * monitoring fleet, the backup router, GitOps apply and two panel modules),
 * each with its own `any` to get past Drizzle's per-table generics. Call
 * sites now do `SERVICE_REGISTRY[kind].module.<op>(...)`.
 *
 * Deliberately free of lifecycle imports (`application/service`,
 * `compose/service`, `databases/engine`): those pull dockerode, Traefik and
 * the preview module, and the registry is imported by light modules such as
 * `application/org.ts`. Start/stop/remove stay where they are; the registry
 * only supplies the row plumbing they are dispatched with.
 */

// ── shared table shape ──────────────────────────────────────────────────────

type ServiceStatusValue = "idle" | "running" | "done" | "error";

/** A `text` primary key / FK column: enough for `eq`/`inArray` and projections. */
export type ServiceIdColumn = AnyPgColumn<{ data: string; notNull: true }>;

/**
 * The columns all seven service tables share. Typing the registry against
 * this (instead of a union of the seven concrete tables) is what lets the
 * generic reads below compile without `any`.
 */
export type ServiceTable = PgTable & {
	name: AnyPgColumn<{ data: string; notNull: true }>;
	appName: AnyPgColumn<{ data: string; notNull: true }>;
	description: AnyPgColumn<{ data: string; notNull: false }>;
	status: AnyPgColumn<{ data: ServiceStatusValue; notNull: true }>;
	environmentId: AnyPgColumn<{ data: string; notNull: true }>;
	serverId: AnyPgColumn<{ data: string; notNull: false }>;
};

const SERVICE_TABLES = {
	application: applications,
	compose,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
} as const satisfies Record<ServiceKind, ServiceTable>;

const SERVICE_TAG_TABLES = {
	application: applicationTags,
	compose: composeTags,
	postgres: postgresTags,
	mysql: mysqlTags,
	mariadb: mariadbTags,
	mongo: mongoTags,
	redis: redisTags,
} as const satisfies Record<ServiceKind, PgTable>;

/** Full row type per kind (`SERVICE_ROWS["postgres"]` ≡ `typeof postgres.$inferSelect`). */
export type ServiceRowMap = {
	[K in ServiceKind]: (typeof SERVICE_TABLES)[K]["$inferSelect"];
};

export type ServiceRow<K extends ServiceKind = ServiceKind> = ServiceRowMap[K];

/** Any service row, regardless of kind. */
export type AnyServiceRow = ServiceRowMap[ServiceKind];

/** Column values accepted by the kind-agnostic insert/update helpers. */
export type ServiceRowValues = Record<string, unknown>;

// ── projections shared by the kind-agnostic call sites ──────────────────────

/** Tenancy context of one service (`getServiceContext`, backup access checks). */
export interface ServiceTenancy {
	serviceId: string;
	name: string;
	appName: string;
	serverId: string | null;
	environmentId: string;
	organizationId: string;
}

/** Row shape the fleet/monitoring listing needs. */
export interface ServiceSummary {
	kind: ServiceKind;
	serviceId: string;
	name: string;
	appName: string;
	status: ServiceStatusValue;
	serverId: string | null;
	environmentId: string;
}

export interface ServiceTagAssignment {
	serviceId: string;
	tagId: string;
	name: string;
	color: string;
}

// ── per-kind module ─────────────────────────────────────────────────────────

/**
 * The row operations every kind-agnostic caller needs. Each method takes an
 * optional {@link DbExecutor} so callers can run several of them inside one
 * `db.transaction(...)`.
 */
export interface ServiceKindModule<K extends ServiceKind = ServiceKind> {
	/** Primary key of a row of this kind (`row.postgresId`, `row.composeId`, …). */
	rowId(row: ServiceRowMap[K]): string;
	/** Full row by primary key. */
	findById(serviceId: string, executor?: DbExecutor): Promise<ServiceRowMap[K] | undefined>;
	/** Full row by environment + service name (GitOps addresses services by name). */
	findByName(
		environmentId: string,
		name: string,
		executor?: DbExecutor,
	): Promise<ServiceRowMap[K] | undefined>;
	/** Tenancy context (service → environment → project → organization). */
	findTenancy(serviceId: string, executor?: DbExecutor): Promise<ServiceTenancy | undefined>;
	/** Same, addressed by the globally unique swarm `appName`. */
	findTenancyByAppName(appName: string, executor?: DbExecutor): Promise<ServiceTenancy | undefined>;
	/** Every row of one environment. */
	listByEnvironment(environmentId: string, executor?: DbExecutor): Promise<ServiceRowMap[K][]>;
	/** Listing projection across many environments (fleet view). */
	listSummaries(environmentIds: string[], executor?: DbExecutor): Promise<ServiceSummary[]>;
	/**
	 * `(environmentId, status, count)` rows for a batch of environments — the
	 * dashboard needs both the per-kind totals and the health breakdown, and one
	 * grouped query answers both.
	 */
	countByEnvironment(
		environmentIds: string[],
		executor?: DbExecutor,
	): Promise<Array<{ environmentId: string; status: ServiceStatusValue; value: number }>>;
	/** `(status, count)` pairs across a whole organization. */
	statusCounts(
		organizationId: string,
		executor?: DbExecutor,
	): Promise<Array<{ status: ServiceStatusValue; value: number }>>;
	/** Insert a row (GitOps create path). */
	insert(values: ServiceRowValues, executor?: DbExecutor): Promise<void>;
	/** Patch a row by primary key. */
	updateById(serviceId: string, values: ServiceRowValues, executor?: DbExecutor): Promise<void>;
	/** Delete rows by primary key (environment cascade). */
	deleteByIds(serviceIds: string[], executor?: DbExecutor): Promise<void>;
	/** Replace the service's tag set. Not atomic on its own — pass a transaction. */
	setTags(serviceId: string, tagIds: string[], executor?: DbExecutor): Promise<void>;
	/** Tag assignments of a batch of services, scoped to one organization. */
	listTagAssignments(
		organizationId: string,
		serviceIds: string[],
		executor?: DbExecutor,
	): Promise<ServiceTagAssignment[]>;
}

export interface ServiceKindDef<K extends ServiceKind = ServiceKind> {
	kind: K;
	/** Drizzle table backing this kind. */
	table: ServiceTable;
	/** Primary-key column of {@link table}. */
	idColumn: ServiceIdColumn;
	/** Primary-key field name — also the tRPC input key (`"postgresId"`). */
	idField: ServiceIdField<K>;
	/** Human label (panel headings, menus). */
	label: string;
	/** True for the five one-click database engines. */
	isDatabase: boolean;
	/** `<kind>_tag` join table. */
	tagTable: PgTable;
	/** FK column on `backup` for this kind, or `null` (application/compose). */
	backupColumn: ServiceIdColumn | null;
	module: ServiceKindModule<K>;
}

const first = <T>(rows: T[]): T | undefined => rows[0];

/**
 * Build one registry entry. Drizzle's builders are generic over the concrete
 * table, so the two projections that select individual columns go through
 * {@link ServiceTable}; the row results are re-typed to the kind's row (the
 * statements are literally `select * from <that table>`).
 */
function defineServiceKind<K extends ServiceKind>(kind: K): ServiceKindDef<K> {
	const table: ServiceTable = SERVICE_TABLES[kind];
	const tagTable: PgTable = SERVICE_TAG_TABLES[kind];
	const idField = serviceIdField(kind);
	// `<kind>Id` is the primary key on the service table and the FK on both the
	// `<kind>_tag` join table and `backup` (application/compose have no backup FK).
	const columnsOf = (source: PgTable): Record<string, ServiceIdColumn | undefined> =>
		source as unknown as Record<string, ServiceIdColumn | undefined>;
	const idColumn = columnsOf(table)[idField] as ServiceIdColumn;
	const tagServiceColumn = columnsOf(tagTable)[idField] as ServiceIdColumn;
	const tagIdColumn = columnsOf(tagTable).tagId as ServiceIdColumn;
	const backupColumn = columnsOf(backups)[idField] ?? null;

	const rows = (result: unknown[]): ServiceRowMap[K][] => result as ServiceRowMap[K][];

	const selectTenancy = async (where: SQL, executor: DbExecutor): Promise<ServiceTenancy[]> =>
		await executor
			.select({
				serviceId: idColumn,
				name: table.name,
				appName: table.appName,
				serverId: table.serverId,
				environmentId: table.environmentId,
				organizationId: projects.organizationId,
			})
			.from(table)
			.innerJoin(environments, eq(table.environmentId, environments.environmentId))
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(where)
			.limit(1);

	const module: ServiceKindModule<K> = {
		rowId(row) {
			return (row as Record<string, unknown>)[idField] as string;
		},

		async findById(serviceId, executor = db) {
			return first(
				rows(await executor.select().from(table).where(eq(idColumn, serviceId)).limit(1)),
			);
		},

		async findByName(environmentId, name, executor = db) {
			return first(
				rows(
					await executor
						.select()
						.from(table)
						.where(and(eq(table.environmentId, environmentId), eq(table.name, name)))
						.limit(1),
				),
			);
		},

		async findTenancy(serviceId, executor = db) {
			return first(await selectTenancy(eq(idColumn, serviceId), executor));
		},

		async findTenancyByAppName(appName, executor = db) {
			return first(await selectTenancy(eq(table.appName, appName), executor));
		},

		async listByEnvironment(environmentId, executor = db) {
			return rows(
				await executor.select().from(table).where(eq(table.environmentId, environmentId)),
			);
		},

		async listSummaries(environmentIds, executor = db) {
			if (environmentIds.length === 0) return [];
			const found = await executor
				.select({
					serviceId: idColumn,
					name: table.name,
					appName: table.appName,
					status: table.status,
					serverId: table.serverId,
					environmentId: table.environmentId,
				})
				.from(table)
				.where(inArray(table.environmentId, environmentIds));
			return found.map((row) => ({ kind, ...row }));
		},

		async countByEnvironment(environmentIds, executor = db) {
			if (environmentIds.length === 0) return [];
			return await executor
				.select({ environmentId: table.environmentId, status: table.status, value: count() })
				.from(table)
				.where(inArray(table.environmentId, environmentIds))
				.groupBy(table.environmentId, table.status);
		},

		async statusCounts(organizationId, executor = db) {
			return await executor
				.select({ status: table.status, value: count() })
				.from(table)
				.innerJoin(environments, eq(table.environmentId, environments.environmentId))
				.innerJoin(projects, eq(environments.projectId, projects.projectId))
				.where(eq(projects.organizationId, organizationId))
				.groupBy(table.status);
		},

		async insert(values, executor = db) {
			await executor.insert(table).values(values);
		},

		async updateById(serviceId, values, executor = db) {
			await executor.update(table).set(values).where(eq(idColumn, serviceId));
		},

		async deleteByIds(serviceIds, executor = db) {
			if (serviceIds.length === 0) return;
			await executor.delete(table).where(inArray(idColumn, serviceIds));
		},

		async setTags(serviceId, tagIds, executor = db) {
			await executor.delete(tagTable).where(eq(tagServiceColumn, serviceId));
			if (tagIds.length === 0) return;
			await executor
				.insert(tagTable)
				.values(tagIds.map((tagId) => ({ [idField]: serviceId, tagId })));
		},

		async listTagAssignments(organizationId, serviceIds, executor = db) {
			if (serviceIds.length === 0) return [];
			return await executor
				.select({
					serviceId: tagServiceColumn,
					tagId: tags.tagId,
					name: tags.name,
					color: tags.color,
				})
				.from(tagTable)
				.innerJoin(tags, eq(tagIdColumn, tags.tagId))
				.where(and(eq(tags.organizationId, organizationId), inArray(tagServiceColumn, serviceIds)));
		},
	};

	return {
		kind,
		table,
		idColumn,
		idField,
		label: SERVICE_KIND_LABELS[kind],
		isDatabase: isDatabaseServiceKind(kind),
		tagTable,
		backupColumn,
		module,
	};
}

/** The registry. `SERVICE_REGISTRY[kind]` replaces every seven-way kind switch. */
export const SERVICE_REGISTRY: { [K in ServiceKind]: ServiceKindDef<K> } = {
	application: defineServiceKind("application"),
	compose: defineServiceKind("compose"),
	postgres: defineServiceKind("postgres"),
	mysql: defineServiceKind("mysql"),
	mariadb: defineServiceKind("mariadb"),
	mongo: defineServiceKind("mongo"),
	redis: defineServiceKind("redis"),
};

/**
 * Registry entry for a kind only known at runtime. `SERVICE_REGISTRY[kind]`
 * with a union `kind` yields a union of entries whose method parameters
 * intersect; these accessors widen it back to one callable entry.
 */
export const serviceDef = (kind: ServiceKind): ServiceKindDef => SERVICE_REGISTRY[kind];

/** Same, for the five database engines. */
export const databaseDef = (kind: DatabaseServiceKind): ServiceKindDef<DatabaseServiceKind> =>
	SERVICE_REGISTRY[kind];

/** Registry entries in `SERVICE_KINDS` order (panel grouping order). */
export const SERVICE_DEFS: ServiceKindDef[] = SERVICE_KINDS.map((kind) => SERVICE_REGISTRY[kind]);

/** Registry entries for the five database engines. */
export const DATABASE_DEFS: Array<ServiceKindDef<DatabaseServiceKind>> = DATABASE_KINDS.map(
	(kind) => SERVICE_REGISTRY[kind],
);

/**
 * Find any service by its swarm `appName`, which is unique across all seven
 * tables (`isAppNameTaken` enforces it on create). Used where a caller only
 * knows the deployed service name — metrics history, replica stats, the
 * generic deploy webhook.
 */
export async function findServiceByAppName(
	appName: string,
	executor: DbExecutor = db,
): Promise<(ServiceTenancy & { kind: ServiceKind }) | undefined> {
	const found = await Promise.all(
		SERVICE_DEFS.map(async (def) => {
			const row = await def.module.findTenancyByAppName(appName, executor);
			return row ? { ...row, kind: def.kind } : undefined;
		}),
	);
	return found.find((row) => row !== undefined);
}

// ── shared zod enums ────────────────────────────────────────────────────────

/** Every service kind — routers, MCP tools and GitOps share this enum. */
export const serviceKindSchema = z.enum(SERVICE_KINDS);

/** The five database engines (the `web-server` backup target is not one). */
export const databaseKindSchema = z.enum(DATABASE_KINDS);

// ── schema drift guard ──────────────────────────────────────────────────────

/**
 * The `service_type` pgEnum (mount/port/domain FKs) and {@link SERVICE_KINDS}
 * must describe the same set. A migration that adds a value without touching
 * the registry — or the other way round — fails here at import time rather
 * than at the first query with a bad kind.
 */
function assertServiceTypeEnumMatchesKinds(): void {
	const enumValues = [...serviceType.enumValues].sort();
	const kinds = [...SERVICE_KINDS].sort();
	if (enumValues.length !== kinds.length || enumValues.some((value, i) => value !== kinds[i])) {
		throw new Error(
			`service_type pgEnum [${enumValues.join(", ")}] does not match SERVICE_KINDS [${kinds.join(", ")}]. ` +
				"Update modules/services/kinds.ts and db/schema/enums.ts together.",
		);
	}
}

assertServiceTypeEnumMatchesKinds();

export { assertServiceTypeEnumMatchesKinds };
