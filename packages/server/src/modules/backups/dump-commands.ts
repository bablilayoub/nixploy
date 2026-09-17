/**
 * Dump/restore command matrix for the supported database engines.
 *
 * The commands run INSIDE the database container (via `docker exec`).
 * - `dumpCommand` writes the raw (uncompressed) dump bytes to stdout.
 * - `restoreCommand` reads the raw (uncompressed) dump bytes from stdin.
 *
 * Passwords are never placed on argv. MySQL/MariaDB read `MYSQL_PWD`;
 * MongoDB tools read theirs from a throwaway `--config` YAML file written
 * from `MONGO_PASSWORD`. The backup runner feeds those variables to the
 * container shell through stdin (never the docker/ps argv surface).
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

/**
 * mongodump/mongorestore accept sensitive options (`password`, `uri`) from a
 * `--config` YAML file (database-tools >= 100.0), which keeps the password
 * off the container's process argv. The file is written under umask 077
 * from `$MONGO_PASSWORD` (YAML single-quote escaping) and removed once the
 * tool exits; the tool's exit status is preserved.
 */
const withMongoConfig = (tool: "mongodump" | "mongorestore", args: string) =>
	`umask 077; __cfg=$(mktemp) && printf "password: '%s'\\n" "$(printf '%s' "$MONGO_PASSWORD" | sed "s/'/''/g")" >"$__cfg" && ${tool} --config="$__cfg" ${args}; __mongo_rc=$?; rm -f "$__cfg"; [ "$__mongo_rc" -eq 0 ]`;

export const DB_DUMP_CONFIG: Record<BackupDatabaseType, DumpEngineConfig> = {
	postgres: {
		extension: "sql",
		// Local connections inside the official postgres image are trust-authenticated,
		// so no password is needed here. `--clean
		// --if-exists` makes the dump restorable into a database that already
		// holds the schema (psql runs with ON_ERROR_STOP).
		dumpCommand: ({ database, databaseUser }) =>
			`pg_dump -U ${sq(databaseUser)} -d ${sq(database)} --no-owner --no-privileges --clean --if-exists`,
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
			withMongoConfig(
				"mongodump",
				`-u ${sq(databaseUser)} --authenticationDatabase admin -d ${sq(database)} --archive`,
			),
		restoreCommand: ({ database, databaseUser }) =>
			withMongoConfig(
				"mongorestore",
				`-u ${sq(databaseUser)} --authenticationDatabase admin -d ${sq(database)} --archive --drop`,
			),
	},
};
