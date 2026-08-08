/**
 * Dump/restore command matrix for the supported database engines.
 *
 * The commands run INSIDE the database container (via `docker exec`).
 * - `dumpCommand` writes the raw (uncompressed) dump bytes to stdout.
 * - `restoreCommand` reads the raw (uncompressed) dump bytes from stdin.
 *
 * Passwords are never placed on argv. MySQL/MariaDB read `MYSQL_PWD`;
 * MongoDB reads `MONGO_PASSWORD`. The backup runner injects those via
 * `docker exec -e VAR` from the Node/SSH process environment (not the
 * shell command string).
 *
 * Compression (gzip) and transport-safe encoding (base64) are applied by the
 * backup runner, so these commands stay plain and binary-safe.
 */

/** Quote a value for POSIX single-quoted shell contexts. */
const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Database types that support scheduled dumps (subset of the `database_type` enum). */
export type BackupDatabaseType = "postgres" | "mysql" | "mariadb" | "mongo";

export interface DumpCommandParams {
	/** Logical database name to dump/restore (from the backup row). */
	database: string;
	databaseUser: string;
	databasePassword: string;
	/** Only present on mysql/mariadb services. */
	databaseRootPassword?: string | null;
}

export interface DumpEngineConfig {
	/** File extension of the uncompressed dump, before the runner appends `.gz`. */
	extension: "sql" | "archive";
	/** Env vars the runner must pass into `docker exec -e` (never on argv). */
	passwordEnv?: (params: DumpCommandParams) => Record<string, string>;
	dumpCommand(params: DumpCommandParams): string;
	restoreCommand(params: DumpCommandParams): string;
}

export const DB_DUMP_CONFIG: Record<BackupDatabaseType, DumpEngineConfig> = {
	postgres: {
		extension: "sql",
		// Local connections inside the official postgres image are trust-authenticated,
		// so no password is needed here (same approach as Dokploy).
		dumpCommand: ({ database, databaseUser }) =>
			`pg_dump -U ${sq(databaseUser)} -d ${sq(database)} --no-owner --no-privileges`,
		restoreCommand: ({ database, databaseUser }) =>
			`psql -U ${sq(databaseUser)} -d ${sq(database)} -v ON_ERROR_STOP=1`,
	},
	mysql: {
		extension: "sql",
		passwordEnv: ({ databasePassword }) => ({ MYSQL_PWD: databasePassword }),
		dumpCommand: ({ database, databaseUser }) =>
			`mysqldump --default-character-set=utf8mb4 -u ${sq(databaseUser)} --databases ${sq(database)}`,
		restoreCommand: ({ database, databaseUser }) =>
			`mysql --default-character-set=utf8mb4 -u ${sq(databaseUser)} ${sq(database)}`,
	},
	mariadb: {
		extension: "sql",
		passwordEnv: ({ databasePassword }) => ({ MYSQL_PWD: databasePassword }),
		dumpCommand: ({ database, databaseUser }) =>
			`mariadb-dump --default-character-set=utf8mb4 -u ${sq(databaseUser)} --databases ${sq(database)}`,
		restoreCommand: ({ database, databaseUser }) =>
			`mariadb --default-character-set=utf8mb4 -u ${sq(databaseUser)} ${sq(database)}`,
	},
	mongo: {
		extension: "archive",
		passwordEnv: ({ databasePassword }) => ({ MONGO_PASSWORD: databasePassword }),
		dumpCommand: ({ database, databaseUser }) =>
			`mongodump -u ${sq(databaseUser)} -p "$MONGO_PASSWORD" --authenticationDatabase admin -d ${sq(database)} --archive`,
		restoreCommand: ({ database, databaseUser }) =>
			`mongorestore -u ${sq(databaseUser)} -p "$MONGO_PASSWORD" --authenticationDatabase admin -d ${sq(database)} --archive --drop`,
	},
};
