/**
 * Command matrix for restore verification ("test restore").
 *
 * A stored dump is restored into a throwaway container of the same engine
 * image — no ports, `--network none`, a random `nixploy-verify-<id>` name —
 * and the engine's liveness query must answer. Nothing here touches the
 * live database service.
 *
 * The throwaway container needs no real credentials: Postgres runs with
 * `POSTGRES_HOST_AUTH_METHOD=trust`, MySQL/MariaDB with an empty root
 * password, MongoDB without auth and Redis without `--requirepass`. That
 * keeps every secret off `docker run` argv (visible in `ps` and
 * `docker inspect`) — only the user and database *names* are interpolated.
 *
 * Pure string helpers, unit-tested as exact strings (injection guard).
 */

export type VerifyEngine = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface VerifyTarget {
	engine: VerifyEngine;
	/** Image the throwaway container runs (the source service's image). */
	image: string;
	/** Logical database name the dump was taken from. */
	database: string;
	/** Database user the dump was taken with (Postgres restores as it). */
	user: string;
}

/** Name prefix of verification containers (`docker ps --filter name=nixploy-verify-`). */
export const VERIFY_CONTAINER_PREFIX = "nixploy-verify-";

/** Label set on every verification container so leftovers can be swept. */
export const VERIFY_CONTAINER_LABEL = "nixploy.verify=1";

/** Seconds between readiness probes and how many to attempt (2 s × 90 = 3 min). */
export const VERIFY_READY_ATTEMPTS = 90;
export const VERIFY_READY_INTERVAL_SECONDS = 2;

/** Quote a value for POSIX single-quoted shell contexts. */
const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** `nixploy-verify-<hex>`; the id must already be a hex token. */
export function buildVerifyContainerName(id: string): string {
	if (!/^[a-f0-9]{8,32}$/.test(id)) {
		throw new Error("Verify container id must be a hex token");
	}
	return `${VERIFY_CONTAINER_PREFIX}${id}`;
}

interface EngineVerifyConfig {
	/** `docker run` flags (env, entrypoint args) before the image. */
	runFlags(target: VerifyTarget): string;
	/** Args appended after the image (`docker run … <image> <args>`). */
	imageArgs(target: VerifyTarget): string;
	/** Command run inside the container until it exits 0. */
	readyProbe(target: VerifyTarget): string;
	/** Command inside the container that reads the raw dump on stdin. */
	restoreCommand(target: VerifyTarget): string;
	/** Liveness query; stdout must contain {@link expected} on its own line. */
	livenessCommand(target: VerifyTarget): string;
	expected: string;
}

const VERIFY_ENGINES: Record<VerifyEngine, EngineVerifyConfig> = {
	postgres: {
		runFlags: ({ user, database }) =>
			`-e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=${sq(user)} -e POSTGRES_DB=${sq(database)}`,
		imageArgs: () => "",
		readyProbe: ({ user, database }) => `pg_isready -U ${sq(user)} -d ${sq(database)}`,
		restoreCommand: ({ user, database }) =>
			`psql -q -U ${sq(user)} -d ${sq(database)} -v ON_ERROR_STOP=1`,
		livenessCommand: ({ user, database }) =>
			`psql -At -U ${sq(user)} -d ${sq(database)} -c 'SELECT 1'`,
		expected: "1",
	},
	mysql: {
		runFlags: ({ database }) =>
			`-e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=${sq(database)}`,
		imageArgs: () => "",
		// The entrypoint runs a socket-only bootstrap server first; a TCP ping
		// only succeeds once the real server listens.
		readyProbe: () => "mysqladmin ping -h 127.0.0.1 -u root --silent",
		restoreCommand: () => "mysql --default-character-set=utf8mb4 -u root",
		livenessCommand: ({ database }) => `mysql -u root -N -s ${sq(database)} -e 'SELECT 1'`,
		expected: "1",
	},
	mariadb: {
		runFlags: ({ database }) =>
			`-e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=yes -e MARIADB_DATABASE=${sq(database)}`,
		imageArgs: () => "",
		readyProbe: () => "mariadb-admin ping -h 127.0.0.1 -u root --silent",
		restoreCommand: () => "mariadb --default-character-set=utf8mb4 -u root",
		livenessCommand: ({ database }) => `mariadb -u root -N -s ${sq(database)} -e 'SELECT 1'`,
		expected: "1",
	},
	mongo: {
		runFlags: () => "",
		imageArgs: () => "",
		readyProbe: () => `mongosh --quiet --eval 'db.adminCommand("ping").ok'`,
		// The archive was taken with `-d <db>`; mongorestore puts it back under
		// the same name. `--drop` is a no-op on a fresh container.
		restoreCommand: () => "mongorestore --quiet --archive --drop",
		livenessCommand: ({ database }) => `mongosh --quiet ${sq(database)} --eval 'db.stats().ok'`,
		expected: "1",
	},
	redis: {
		runFlags: () => "",
		// Same persistence flag as the engine's default args so a restored
		// AOF (appendonlydir/) is replayed exactly like on the live service.
		imageArgs: () => "redis-server --appendonly yes",
		readyProbe: () => "redis-cli PING | grep -q PONG",
		restoreCommand: () => "",
		livenessCommand: () => "redis-cli PING",
		expected: "PONG",
	},
};

/** Expected liveness answer (`1` for SQL/Mongo, `PONG` for Redis). */
export function expectedLivenessOutput(engine: VerifyEngine): string {
	return VERIFY_ENGINES[engine].expected;
}

function runFlags(name: string, target: VerifyTarget): string {
	const engine = VERIFY_ENGINES[target.engine];
	const flags = engine.runFlags(target);
	const args = engine.imageArgs(target);
	return (
		`--name ${sq(name)} --network none --label ${sq(VERIFY_CONTAINER_LABEL)}` +
		`${flags ? ` ${flags}` : ""} ${sq(target.image)}${args ? ` ${args}` : ""}`
	);
}

/**
 * Start the throwaway container (`docker run -d`). Not `--rm`: the container
 * must survive a crash so its logs can explain a failed readiness wait;
 * {@link buildVerifyCleanupCommand} removes it in `finally`.
 */
export function buildVerifyRunCommand(name: string, target: VerifyTarget): string {
	return `docker run -d ${runFlags(name, target)}`;
}

/**
 * Redis loads its data directory at startup only, so its container is
 * created stopped, the snapshot tar is copied in, then it is started.
 */
export function buildVerifyCreateCommand(name: string, target: VerifyTarget): string {
	return `docker create ${runFlags(name, target)}`;
}

export function buildVerifyStartCommand(name: string): string {
	return `docker start ${sq(name)}`;
}

/**
 * Poll the readiness probe inside the container. Prints the container's
 * last log lines to stderr and exits 1 when it never comes up.
 */
export function buildVerifyWaitCommand(
	name: string,
	target: VerifyTarget,
	attempts = VERIFY_READY_ATTEMPTS,
	intervalSeconds = VERIFY_READY_INTERVAL_SECONDS,
): string {
	const probe = VERIFY_ENGINES[target.engine].readyProbe(target);
	return (
		`i=0; while [ $i -lt ${attempts} ]; do ` +
		`docker exec ${sq(name)} sh -c ${sq(probe)} >/dev/null 2>&1 && exit 0; ` +
		`sleep ${intervalSeconds}; i=$((i + 1)); done; ` +
		`echo ${sq(`${target.engine} did not accept connections within ${attempts * intervalSeconds}s`)} >&2; ` +
		`docker logs --tail 20 ${sq(name)} >&2 2>&1; exit 1`
	);
}

/**
 * Restore the base64-encoded gzip archive (fed on stdin) into the container.
 * SQL/Mongo engines stream the raw dump into their restore tool; Redis
 * unpacks the data-directory tar into the (stopped) container root.
 */
export function buildVerifyRestoreCommand(name: string, target: VerifyTarget): string {
	if (target.engine === "redis") {
		return `base64 -d | gunzip | docker cp - ${sq(name)}:/`;
	}
	const restore = VERIFY_ENGINES[target.engine].restoreCommand(target);
	return `base64 -d | gunzip | docker exec -i ${sq(name)} sh -c ${sq(restore)}`;
}

/** Engine liveness query, run after the restore. */
export function buildVerifyLivenessCommand(name: string, target: VerifyTarget): string {
	const query = VERIFY_ENGINES[target.engine].livenessCommand(target);
	return `docker exec ${sq(name)} sh -c ${sq(query)}`;
}

/** Remove the container whatever state it is in; never fails. */
export function buildVerifyCleanupCommand(name: string): string {
	return `docker rm -f ${sq(name)} >/dev/null 2>&1 || true`;
}

/** Whether the liveness output carries the expected answer on its own line. */
export function livenessAnswered(engine: VerifyEngine, output: string): boolean {
	const expected = expectedLivenessOutput(engine);
	return output.split(/\r?\n/).some((line) => line.trim() === expected);
}
