import type { LucideIcon } from "lucide-react";
import { Cylinder, Database, DatabaseZap, Layers } from "lucide-react";

export type DatabaseType = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

/** Database types supported by the `backup` router (no redis dumps). */
export type BackupDatabaseType = Exclude<DatabaseType, "redis">;

export type ServiceStatus = "idle" | "running" | "done" | "error";

export interface DatabaseTypeConfig {
	/** Key used for the id in procedure inputs (e.g. `"postgresId"`). */
	idField: string;
	label: string;
	icon: LucideIcon;
	iconClassName: string;
	supportsBackups: boolean;
	hasDatabaseName: boolean;
	hasUser: boolean;
	hasRootPassword: boolean;
}

export const DATABASE_TYPES: Record<DatabaseType, DatabaseTypeConfig> = {
	postgres: {
		idField: "postgresId",
		label: "PostgreSQL",
		icon: Cylinder,
		iconClassName: "bg-sky-500/15 text-sky-400",
		supportsBackups: true,
		hasDatabaseName: true,
		hasUser: true,
		hasRootPassword: false,
	},
	mysql: {
		idField: "mysqlId",
		label: "MySQL",
		icon: Database,
		iconClassName: "bg-blue-500/15 text-blue-400",
		supportsBackups: true,
		hasDatabaseName: true,
		hasUser: true,
		hasRootPassword: true,
	},
	mariadb: {
		idField: "mariadbId",
		label: "MariaDB",
		icon: Database,
		iconClassName: "bg-amber-500/15 text-amber-400",
		supportsBackups: true,
		hasDatabaseName: true,
		hasUser: true,
		hasRootPassword: true,
	},
	mongo: {
		idField: "mongoId",
		label: "MongoDB",
		icon: Layers,
		iconClassName: "bg-green-500/15 text-green-400",
		supportsBackups: true,
		hasDatabaseName: false,
		hasUser: true,
		hasRootPassword: false,
	},
	redis: {
		idField: "redisId",
		label: "Redis",
		icon: DatabaseZap,
		iconClassName: "bg-red-500/15 text-red-400",
		supportsBackups: false,
		hasDatabaseName: false,
		hasUser: false,
		hasRootPassword: false,
	},
};

/** Normalized shape shared by all five database rows (optional per-type fields). */
export interface DatabaseRow {
	name: string;
	appName: string;
	description: string | null;
	env: string | null;
	status: ServiceStatus;
	dockerImage: string;
	databaseName?: string;
	databaseUser?: string;
	databasePassword?: string;
	databaseRootPassword?: string;
	externalPort: number | null;
	serverId: string | null;
	createdAt: string;
}

// biome-ignore lint/suspicious/noExplicitAny: the five database routers share an identical procedure surface; only the id input key differs
type AnyRpc = any;

/**
 * Keyed id input for database procedures, e.g. `{ postgresId: "..." }`.
 * The key depends on the database type, so it stays untyped behind the facade.
 */
// biome-ignore lint/suspicious/noExplicitAny: keyed id input ({ postgresId } / { mysqlId } / ...)
export type DatabaseIdInput = any;

/**
 * Common facade over `trpc.postgres | mysql | mariadb | mongo | redis`.
 * All five routers expose the same Dokploy-style procedures (see
 * `buildDatabaseRouter` in @nixploy/server); only the id field name differs.
 */
export interface DatabaseRouterFacade {
	one: {
		queryOptions: (input: AnyRpc, opts?: AnyRpc) => AnyRpc;
		queryKey: (input?: AnyRpc) => AnyRpc;
	};
	update: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	remove: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	start: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	stop: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	reload: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	saveEnvironment: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	saveExternalPort: { mutationOptions: (opts?: AnyRpc) => AnyRpc };
	getConnectionUrl: {
		queryOptions: (input: AnyRpc, opts?: AnyRpc) => AnyRpc;
		queryKey: (input?: AnyRpc) => AnyRpc;
	};
	getStatus: {
		queryOptions: (input: AnyRpc, opts?: AnyRpc) => AnyRpc;
		queryKey: (input?: AnyRpc) => AnyRpc;
	};
}

export interface ConnectionUrls {
	internal: string;
	external: string | null;
}
