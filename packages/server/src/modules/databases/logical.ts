/**
 * Additional logical databases (and their owning users) inside one managed
 * engine.
 *
 * Nixploy provisions exactly one database per service; teams routinely want a
 * second one (a staging schema, a sidecar service, a per-tenant database)
 * without paying for another container. This module creates them the way an
 * operator would: `docker exec` into the running container and speak the
 * engine's own client over **stdin**.
 *
 * Two rules shape everything here:
 *
 * - The panel never reaches a managed database over the network (CLAUDE.md
 *   network model): databases sit on their environment's private overlay and
 *   the panel is not on it. `docker exec` is the only supported path.
 * - Passwords never reach argv. The generated password travels inside the SQL
 *   on stdin; the engine's own root password stays an env var that is only
 *   dereferenced inside the container.
 *
 * The command builders are pure and unit-tested; only
 * {@link runLogicalCommand} touches Docker.
 */

import { randomBytes } from "node:crypto";
import { execAsync, execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { badRequest } from "../errors";
import type { DatabaseKind, DatabaseRowMap } from "./engine";

/** Engines that have a concept of "another database inside this server". */
export const LOGICAL_DATABASE_KINDS = ["postgres", "mysql", "mariadb", "mongo"] as const;

export type LogicalDatabaseKind = (typeof LOGICAL_DATABASE_KINDS)[number];

const LOGICAL_KIND_SET: ReadonlySet<string> = new Set(LOGICAL_DATABASE_KINDS);

/** Redis has one keyspace and numbered databases — nothing to create. */
export const supportsLogicalDatabases = (kind: DatabaseKind): kind is LogicalDatabaseKind =>
	LOGICAL_KIND_SET.has(kind);

/**
 * Identifiers are interpolated into SQL. They are restricted to a portable
 * lowercase identifier rather than escaped: every engine quotes differently,
 * Postgres folds unquoted names to lowercase, and MySQL's backtick escaping
 * has enough corner cases that "reject anything surprising" is the only rule
 * worth trusting. 63 characters is Postgres's `NAMEDATALEN - 1`.
 */
export const LOGICAL_IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export const assertLogicalIdentifier = (value: string, label: string): string => {
	if (!LOGICAL_IDENTIFIER_RE.test(value)) {
		throw badRequest(
			`Invalid ${label} “${value}”: use 1–63 lowercase letters, digits and underscores, starting with a letter or underscore`,
		);
	}
	return value;
};

/**
 * Names the engines own. Creating a user called `postgres` or a database
 * called `mysql` either fails loudly or, worse, succeeds and shadows
 * something the container needs.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
	"postgres",
	"template0",
	"template1",
	"mysql",
	"sys",
	"performance_schema",
	"information_schema",
	"admin",
	"local",
	"config",
	"root",
]);

export const assertLogicalNameAvailable = (name: string, label: string): string => {
	if (RESERVED_NAMES.has(name)) {
		throw badRequest(`“${name}” is reserved by the database engine; pick another ${label}`);
	}
	return name;
};

/**
 * A generated password: base64url, so it carries no quote, backslash or
 * whitespace and is safe inside a single-quoted SQL literal and a JSON
 * string alike. 24 bytes ≈ 192 bits.
 */
export const generateLogicalPassword = (): string => randomBytes(24).toString("base64url");

export interface LogicalDatabaseSpec {
	name: string;
	username: string;
	password: string;
}

/** One engine command: what to run inside the container, and what to feed it. */
export interface LogicalCommand {
	/** Argument of `sh -c` inside the container. */
	shell: string;
	/** Script piped to that command's stdin. */
	stdin: string;
}

// ── per-engine command builders (pure) ──────────────────────────────────────

/**
 * Postgres. `psql` authenticates over the local socket as the superuser the
 * image created, exactly as the backup dumps do, so no password is needed to
 * connect. `ON_ERROR_STOP` turns a failed statement into a non-zero exit —
 * without it psql happily reports success after `CREATE DATABASE` failed.
 */
const postgresCreate = (spec: LogicalDatabaseSpec): LogicalCommand => ({
	shell: 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
	stdin: [
		`CREATE ROLE "${spec.username}" LOGIN PASSWORD '${spec.password}';`,
		`CREATE DATABASE "${spec.name}" OWNER "${spec.username}";`,
		`GRANT ALL PRIVILEGES ON DATABASE "${spec.name}" TO "${spec.username}";`,
		"",
	].join("\n"),
});

const postgresDrop = (spec: Pick<LogicalDatabaseSpec, "name" | "username">): LogicalCommand => ({
	shell: 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
	stdin: [
		// Sessions still attached would make DROP DATABASE fail; the role can
		// only go once nothing it owns is left.
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${spec.name}' AND pid <> pg_backend_pid();`,
		`DROP DATABASE IF EXISTS "${spec.name}";`,
		`DROP ROLE IF EXISTS "${spec.username}";`,
		"",
	].join("\n"),
});

/**
 * MySQL / MariaDB. The root password is referenced as an env var **inside**
 * the container (the same shape the dump commands use), so it never reaches
 * the host's argv. `@'%'` because clients connect from other containers on
 * the environment overlay, never from localhost.
 */
const mysqlFamilyCreate = (
	client: "mysql" | "mariadb",
	passwordEnv: string,
	spec: LogicalDatabaseSpec,
): LogicalCommand => ({
	shell: `${client} -u root -p"$${passwordEnv}"`,
	stdin: [
		`CREATE DATABASE IF NOT EXISTS \`${spec.name}\` CHARACTER SET utf8mb4;`,
		`CREATE USER '${spec.username}'@'%' IDENTIFIED BY '${spec.password}';`,
		`GRANT ALL PRIVILEGES ON \`${spec.name}\`.* TO '${spec.username}'@'%';`,
		"FLUSH PRIVILEGES;",
		"",
	].join("\n"),
});

const mysqlFamilyDrop = (
	client: "mysql" | "mariadb",
	passwordEnv: string,
	spec: Pick<LogicalDatabaseSpec, "name" | "username">,
): LogicalCommand => ({
	shell: `${client} -u root -p"$${passwordEnv}"`,
	stdin: [
		`DROP DATABASE IF EXISTS \`${spec.name}\`;`,
		`DROP USER IF EXISTS '${spec.username}'@'%';`,
		"FLUSH PRIVILEGES;",
		"",
	].join("\n"),
});

/**
 * MongoDB. `mongosh` replaced `mongo` in the 6.x images but old tags (and
 * some forks) only ship the legacy shell, so the wrapper picks whichever
 * exists. Neither binary reads stdin before it starts, so the script still
 * arrives intact. `dbOwner` on that one database is the least privilege that
 * lets an app create its own collections and indexes.
 */
const MONGO_SHELL =
	"if command -v mongosh >/dev/null 2>&1; then SHELL_BIN=mongosh; else SHELL_BIN=mongo; fi; " +
	'exec "$SHELL_BIN" --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin';

const mongoCreate = (spec: LogicalDatabaseSpec): LogicalCommand => ({
	shell: MONGO_SHELL,
	stdin: [
		`db.getSiblingDB("${spec.name}").createUser({`,
		`  user: "${spec.username}",`,
		`  pwd: "${spec.password}",`,
		`  roles: [{ role: "dbOwner", db: "${spec.name}" }],`,
		"});",
		// Mongo creates a database lazily; without a first write the database
		// would not show up in `show dbs` and the user would look orphaned.
		`db.getSiblingDB("${spec.name}").createCollection("nixploy_init");`,
		"",
	].join("\n"),
});

const mongoDrop = (spec: Pick<LogicalDatabaseSpec, "name" | "username">): LogicalCommand => ({
	shell: MONGO_SHELL,
	stdin: [
		`try { db.getSiblingDB("${spec.name}").dropUser("${spec.username}"); } catch (error) {}`,
		`db.getSiblingDB("${spec.name}").dropDatabase();`,
		"",
	].join("\n"),
});

/** Command that creates the logical database + owner for one engine. */
export const buildCreateLogicalCommand = (
	kind: LogicalDatabaseKind,
	spec: LogicalDatabaseSpec,
): LogicalCommand => {
	assertLogicalIdentifier(spec.name, "database name");
	assertLogicalIdentifier(spec.username, "username");
	switch (kind) {
		case "postgres":
			return postgresCreate(spec);
		case "mysql":
			return mysqlFamilyCreate("mysql", "MYSQL_ROOT_PASSWORD", spec);
		case "mariadb":
			return mysqlFamilyCreate("mariadb", "MARIADB_ROOT_PASSWORD", spec);
		case "mongo":
			return mongoCreate(spec);
	}
};

/** Command that drops the logical database and its owner. */
export const buildDropLogicalCommand = (
	kind: LogicalDatabaseKind,
	spec: Pick<LogicalDatabaseSpec, "name" | "username">,
): LogicalCommand => {
	assertLogicalIdentifier(spec.name, "database name");
	assertLogicalIdentifier(spec.username, "username");
	switch (kind) {
		case "postgres":
			return postgresDrop(spec);
		case "mysql":
			return mysqlFamilyDrop("mysql", "MYSQL_ROOT_PASSWORD", spec);
		case "mariadb":
			return mysqlFamilyDrop("mariadb", "MARIADB_ROOT_PASSWORD", spec);
		case "mongo":
			return mongoDrop(spec);
	}
};

// ── connection URLs ─────────────────────────────────────────────────────────

const encode = encodeURIComponent;

/**
 * Connection URL for a logical database. Mirrors
 * `DATABASE_CONFIGS[kind].connectionUrl` but with the logical credentials;
 * `host`/`port` are the engine's own (the logical database lives in the same
 * server process).
 */
export const buildLogicalConnectionUrl = (
	kind: LogicalDatabaseKind,
	spec: LogicalDatabaseSpec,
	host: string,
	port: number,
): string => {
	const auth = `${encode(spec.username)}:${encode(spec.password)}`;
	switch (kind) {
		case "postgres":
			return `postgresql://${auth}@${host}:${port}/${spec.name}`;
		case "mysql":
			return `mysql://${auth}@${host}:${port}/${spec.name}`;
		case "mariadb":
			return `mariadb://${auth}@${host}:${port}/${spec.name}`;
		case "mongo":
			return `mongodb://${auth}@${host}:${port}/${spec.name}?authSource=${spec.name}`;
	}
};

// ── execution ───────────────────────────────────────────────────────────────

/** `docker ps` ids are 64 hex chars; the short form is 12. */
const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/;

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Id of the running task container for a swarm service, on the host it runs
 * on. Mirrors the backup runner's lookup; a stopped database has none, which
 * is exactly the precondition the router reports.
 */
export const findDatabaseContainerId = async (
	appName: string,
	serverId: string | null,
): Promise<string> => {
	const command = `docker ps -q --filter ${shellQuote(`label=com.docker.swarm.service.name=${appName}`)} | head -n 1`;
	const output = serverId ? await execAsyncRemote(serverId, command) : await execAsync(command);
	const containerId = output.trim().split("\n")[0]?.trim();
	if (!containerId || !CONTAINER_ID_PATTERN.test(containerId)) {
		throw badRequest(
			`${appName} is not running. Start the database before managing its logical databases.`,
		);
	}
	return containerId;
};

/**
 * Run one engine command inside the database container. The script goes to
 * `docker exec -i … sh -c '<client>'` over **stdin**, so neither the
 * generated password nor the SQL ever appears in `ps` on the host.
 */
export const runLogicalCommand = async (
	containerId: string,
	serverId: string | null,
	command: LogicalCommand,
): Promise<string> =>
	await execAsyncWithStdin(
		`docker exec -i ${shellQuote(containerId)} sh -c ${shellQuote(command.shell)}`,
		command.stdin,
		{ timeout: 60_000, ...(serverId ? { serverId } : {}) },
	);

/** Row shape the logical helpers need from any database row. */
export type LogicalParentRow = Pick<DatabaseRowMap[LogicalDatabaseKind], "appName" | "serverId">;
