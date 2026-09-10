/**
 * Helpers for the two backup engines that don't fit the plain
 * "dump bytes to stdout" model of dump-commands.ts:
 *
 * - `web-server`: the Nixploy instance itself — a pg_dump of the database
 *   pointed at by DATABASE_URL plus a tar.gz of the config directory
 *   (Traefik dynamic configs, certificates, SSH keys, ...).
 * - `redis`: BGSAVE/SAVE inside the container, wait for persistence, then
 *   copy the whole data directory (RDB + AOF when enabled) out with
 *   `docker cp`.
 *
 * Everything here is a pure string/parse helper so the runner branches can
 * be unit-tested without Docker, S3 or a database. Passwords are NEVER put
 * on argv: pg_dump reads PGPASSWORD from the process environment, redis-cli
 * reads REDISCLI_AUTH via stdin inside the container.
 */

/** Fixed appName of instance self-backup rows (also the S3 key directory). */
export const WEB_SERVER_APP_NAME = "web-server";

/** S3 directory of the config archive lives next to the dump's. */
export const WEB_SERVER_CONFIG_SUFFIX = "-config";

/** Quote a value for POSIX single-quoted shell contexts. */
const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

// ── web-server: DATABASE_URL parsing ────────────────────────────────────────

export interface InstanceDatabaseTarget {
	user: string;
	/** Decoded password — pass via PGPASSWORD env, never argv. */
	password: string;
	host: string;
	port: string;
	database: string;
}

/**
 * Parse DATABASE_URL into connection parts. Rejects non-Postgres URLs and
 * URLs missing a host or database name with actionable messages.
 */
export function parseInstanceDatabaseUrl(raw: string | undefined): InstanceDatabaseTarget {
	if (!raw) {
		throw new Error("DATABASE_URL is not set — cannot back up the instance database");
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("DATABASE_URL is not a valid URL");
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new Error(`DATABASE_URL must be a postgres:// URL, got ${url.protocol}//`);
	}
	const database = url.pathname.replace(/^\//, "");
	if (!url.hostname || !database) {
		throw new Error("DATABASE_URL must include a host and a database name");
	}
	return {
		user: decodeURIComponent(url.username || "postgres"),
		password: decodeURIComponent(url.password),
		host: url.hostname,
		port: url.port || "5432",
		database,
	};
}

/**
 * pg_dump against the DATABASE_URL target, run from the Nixploy process.
 * The caller sets PGPASSWORD in the exec environment.
 */
export function buildInstancePgDumpCommand(target: InstanceDatabaseTarget): string {
	return (
		`pg_dump -h ${sq(target.host)} -p ${sq(target.port)} -U ${sq(target.user)} ` +
		`-d ${sq(target.database)} --no-owner --no-privileges`
	);
}

/**
 * `docker ps` filters that locate the instance's own Postgres container when
 * the app image has no pg_dump: the DATABASE_URL host is the Swarm service
 * name in production (`nixploy-postgres`) or the compose service name in
 * docker-compose.dev.yml (`postgres`).
 */
export function buildInstanceContainerFilters(host: string): string[] {
	return [
		`--filter ${sq(`label=com.docker.swarm.service.name=${host}`)}`,
		`--filter ${sq(`label=com.docker.compose.service=${host}`)}`,
		`--filter ${sq(`name=^/${host}$`)}`,
	];
}

/** In-container pg_dump (trust-authenticated local socket, like the postgres engine). */
export function buildInstanceContainerDumpCommand(target: InstanceDatabaseTarget): string {
	return `pg_dump -U ${sq(target.user)} -d ${sq(target.database)} --no-owner --no-privileges`;
}

// ── web-server: config directory archive ────────────────────────────────────

/**
 * Config-dir entries excluded from the instance archive, relative to the
 * config dir (tar sees them as `./<entry>`; `*` globs are allowed):
 *
 * - subtrees that are derived or unbounded (cloned app sources, compose
 *   working dirs, deployment logs, metrics history, build caches, downloaded
 *   tools, uploaded files);
 * - the panel's own secrets file `.env` (ENCRYPTION_KEY, BETTER_AUTH_SECRET,
 *   DATABASE_URL, POSTGRES_PASSWORD — written by install.sh) and any
 *   `.env.*` copy. Shipping the key next to the dump it protects would hand
 *   every stored credential to whoever can read the bucket; operators keep
 *   `.env` separately (docs/instance-backup.md).
 *
 * Everything else — Traefik static/dynamic config, acme.json, SSH keys — is
 * included.
 */
export const CONFIG_ARCHIVE_EXCLUDES = [
	"applications",
	"compose",
	"logs",
	"metrics",
	"cache",
	"tools",
	"files",
	".env",
	".env.*",
] as const;

/**
 * tar.gz the config directory to stdout (minus {@link CONFIG_ARCHIVE_EXCLUDES}).
 * The runner base64-encodes the stream for transport. Patterns are anchored
 * with `./` so `./.env` never matches an unrelated `<app>/.env` deeper down
 * (those subtrees are excluded wholesale anyway).
 */
export function buildConfigArchiveCommand(configDir: string): string {
	const excludes = CONFIG_ARCHIVE_EXCLUDES.map((entry) => `--exclude=${sq(`./${entry}`)}`).join(
		" ",
	);
	return `tar czf - -C ${sq(configDir)} ${excludes} .`;
}

// ── redis ────────────────────────────────────────────────────────────────────

/**
 * Shell script run INSIDE the redis container (`docker exec -i ... sh -c`).
 * Reads REDISCLI_AUTH from stdin (first line), triggers a background save
 * (falling back to a blocking SAVE), waits for persistence to settle, then
 * prints the data directory path as the last stdout line so the runner can
 * `docker cp` it out.
 */
export function buildRedisSnapshotScript(maxWaitSeconds = 120): string {
	const r = "redis-cli --no-auth-warning";
	return [
		"IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH",
		`${r} BGSAVE >/dev/null 2>&1 || ${r} SAVE >/dev/null`,
		`i=0; while [ $i -lt ${maxWaitSeconds} ]; do`,
		`inprog=$(${r} INFO persistence | grep '^rdb_bgsave_in_progress' | cut -d: -f2 | tr -d '[:space:]')`,
		'[ "$inprog" = "0" ] && break',
		"sleep 1; i=$((i + 1))",
		"done",
		// Fail loudly when the last save errored (e.g. disk full).
		`status=$(${r} INFO persistence | grep '^rdb_last_bgsave_status' | cut -d: -f2 | tr -d '[:space:]')`,
		'[ "$status" = "ok" ] || { echo "redis persistence failed: $status" >&2; exit 1; }',
		`${r} CONFIG GET dir | tail -n 1`,
	].join("; ");
}

/**
 * The data directory reported by `CONFIG GET dir` is interpolated into a
 * `docker cp <id>:<dir> -` command — reject anything but a plain absolute
 * path so a hostile/compromised redis cannot inject shell.
 */
export const REDIS_DATA_DIR_PATTERN =
	/^\/(?!\.{1,2}(\/|$))[A-Za-z0-9._-]+(\/(?!\.{1,2}(\/|$))[A-Za-z0-9._-]+)*$/;

export function isSafeRedisDataDir(dir: string): boolean {
	return REDIS_DATA_DIR_PATTERN.test(dir);
}
