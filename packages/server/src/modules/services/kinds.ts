/**
 * The service-kind tuple and the pure, per-kind facts derived from it.
 *
 * This file has **no imports on purpose**: the panel's client components
 * (`components/projects/service-types.ts`) import it through
 * `@nixploy/server/modules/services/kinds`, so anything pulled in here would
 * land in the browser bundle. Everything that needs Drizzle tables, the
 * database handle or a lifecycle function lives in `./registry` instead.
 *
 * Adding a service kind: extend {@link SERVICE_KINDS}, add its label and (for
 * databases) its credential shape below, then add the matching entry in
 * `./registry` — the compiler will point at every remaining hole.
 */

/**
 * Every kind of service a project environment can hold. Order is the order
 * services are grouped in the panel. Must stay in sync with the `service_type`
 * pgEnum (asserted at module load in `./registry`).
 */
export const SERVICE_KINDS = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** The five one-click database engines (`SERVICE_KINDS` minus application/compose). */
export const DATABASE_KINDS = [
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const satisfies readonly ServiceKind[];

export type DatabaseServiceKind = (typeof DATABASE_KINDS)[number];

/**
 * Primary-key field of a kind, both as a type and at runtime. Every service
 * table follows the same `<kind>Id` convention (`applicationId`, `composeId`,
 * `postgresId`, …) and so do the tRPC procedure inputs.
 */
export type ServiceIdField<K extends ServiceKind = ServiceKind> = `${K}Id`;

export const serviceIdField = <K extends ServiceKind>(kind: K): ServiceIdField<K> =>
	`${kind}Id` as ServiceIdField<K>;

export const SERVICE_KIND_ID_FIELDS: { [K in ServiceKind]: ServiceIdField<K> } = {
	application: "applicationId",
	compose: "composeId",
	postgres: "postgresId",
	mysql: "mysqlId",
	mariadb: "mariadbId",
	mongo: "mongoId",
	redis: "redisId",
};

/** Human label for a kind (panel headings, menus, audit copy). */
export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
	application: "Application",
	compose: "Compose",
	postgres: "PostgreSQL",
	mysql: "MySQL",
	mariadb: "MariaDB",
	mongo: "MongoDB",
	redis: "Redis",
};

/**
 * Which credential columns a database engine actually has, and the default
 * value a freshly created row gets. `null` means the engine has no such
 * column (redis has neither user nor database name, mongo has no database
 * name). Consumed by the GitOps apply path and by the panel's database forms.
 */
export interface DatabaseCredentialShape {
	/** Default `databaseName`, or `null` when the engine has no database name. */
	databaseName: string | null;
	/** Default `databaseUser`, or `null` when the engine has no user. */
	databaseUser: string | null;
	/** Whether the engine stores a separate root password. */
	rootPassword: boolean;
}

export const DATABASE_KIND_CREDENTIALS: Record<DatabaseServiceKind, DatabaseCredentialShape> = {
	postgres: { databaseName: "postgres", databaseUser: "postgres", rootPassword: false },
	mysql: { databaseName: "mysql", databaseUser: "mysql", rootPassword: true },
	mariadb: { databaseName: "mariadb", databaseUser: "mariadb", rootPassword: true },
	mongo: { databaseName: null, databaseUser: "mongo", rootPassword: false },
	redis: { databaseName: null, databaseUser: null, rootPassword: false },
};

const DATABASE_KIND_SET: ReadonlySet<string> = new Set(DATABASE_KINDS);

/** Narrow a service kind to one of the five database engines. */
export const isDatabaseServiceKind = (kind: ServiceKind): kind is DatabaseServiceKind =>
	DATABASE_KIND_SET.has(kind);

const SERVICE_KIND_SET: ReadonlySet<string> = new Set(SERVICE_KINDS);

/** Runtime guard for untrusted strings (webhook payloads, REST query params). */
export const isServiceKind = (value: unknown): value is ServiceKind =>
	typeof value === "string" && SERVICE_KIND_SET.has(value);
