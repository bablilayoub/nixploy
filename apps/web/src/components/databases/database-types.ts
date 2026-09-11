import {
	DATABASE_KIND_CREDENTIALS,
	DATABASE_KINDS,
	type DatabaseServiceKind,
	SERVICE_KIND_ID_FIELDS,
} from "@nixploy/server/modules/services/kinds";
import type { LucideIcon } from "lucide-react";

import { SERVICE_TYPE_META } from "@/components/projects/service-types";

/**
 * The five one-click engines, their id field and which credential inputs each
 * one actually has, all derived from the server's service registry
 * (`@nixploy/server/modules/services/kinds`). Adding an engine there makes it
 * appear here — and the compiler flags anything still missing.
 */
export type DatabaseType = DatabaseServiceKind;

/** Database types supported by the `backup` router (all five engines). */
export type BackupDatabaseType = DatabaseType;

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

export const DATABASE_TYPES: Record<DatabaseType, DatabaseTypeConfig> = Object.fromEntries(
	DATABASE_KINDS.map((kind) => {
		const credentials = DATABASE_KIND_CREDENTIALS[kind];
		return [
			kind,
			{
				idField: SERVICE_KIND_ID_FIELDS[kind],
				...SERVICE_TYPE_META[kind],
				// Every engine has a dump/restore command in DB_DUMP_CONFIG.
				supportsBackups: true,
				hasDatabaseName: credentials.databaseName !== null,
				hasUser: credentials.databaseUser !== null,
				hasRootPassword: credentials.rootPassword,
			},
		];
	}),
) as Record<DatabaseType, DatabaseTypeConfig>;

export { SERVICE_TYPE_META };

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
	/** Project services list — invalidate its path key after delete/rename. */
	all: {
		pathKey: () => AnyRpc;
	};
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
