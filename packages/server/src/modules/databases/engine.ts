import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { mariadb, mongo, mysql, postgres, redis, servers } from "../../db/schema";
import { execAsyncRemote } from "../../utils/exec";
import { assertSafePublishedPort } from "../../utils/validators";
import { getSwarmNetwork } from "../application/paths";

/**
 * Shared engine for the five one-click database services (postgres, mysql,
 * mariadb, mongo, redis). Every database is a single-container Docker Swarm
 * service on `nixploy-network` with a named volume `<appName>-data` and an
 * optional host-mode published port for external connections.
 *
 * Local servers are driven through dockerode (socket); remote servers through
 * `docker` CLI over SSH via {@link execAsyncRemote}, mirroring Dokploy's
 * local/remote execution duality.
 */

export type DatabaseKind = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export type PostgresRow = typeof postgres.$inferSelect;
export type MysqlRow = typeof mysql.$inferSelect;
export type MariadbRow = typeof mariadb.$inferSelect;
export type MongoRow = typeof mongo.$inferSelect;
export type RedisRow = typeof redis.$inferSelect;

export interface DatabaseRowMap {
	postgres: PostgresRow;
	mysql: MysqlRow;
	mariadb: MariadbRow;
	mongo: MongoRow;
	redis: RedisRow;
}

export type AnyDatabaseRow = DatabaseRowMap[DatabaseKind];

export type DatabaseStatus = "idle" | "running" | "done" | "error";

/** Generate a swarm-safe unique appName from the service name. */
export function generateDatabaseAppName(name: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "db";
	return `${slug}-${randomBytes(3).toString("hex")}`;
}

const TABLE_BY_KIND = { postgres, mysql, mariadb, mongo, redis } as const;

/**
 * Clone a database row into `environmentId`: fresh appName and timestamps,
 * status `idle`, no external port (it would collide with the source). The
 * engine-managed data volume is NOT copied — mounts stay with the source
 * service. The database password IS copied on purpose so the clone is
 * reachable with the same credentials.
 */
export async function duplicateDatabase<K extends DatabaseKind>(
	kind: K,
	source: DatabaseRowMap[K],
	environmentId: string,
): Promise<DatabaseRowMap[K]> {
	// biome-ignore lint/suspicious/noExplicitAny: drizzle table generics differ per kind
	const table = TABLE_BY_KIND[kind] as any;
	const values: Record<string, unknown> = { ...source };
	// Identity/status fields reset to schema defaults (or explicit values below).
	delete values[`${kind}Id`];
	delete values.createdAt;
	delete values.appName;
	delete values.status;
	delete values.externalPort;
	const inserted = (await db
		.insert(table)
		.values({
			...values,
			appName: generateDatabaseAppName(source.name),
			environmentId,
			status: "idle",
			externalPort: null,
			createdAt: new Date(),
		})
		.returning()) as DatabaseRowMap[K][];
	const row = inserted[0];
	if (!row) throw new Error(`Failed to duplicate ${kind} service`);
	return row;
}

// ── per-type configuration ──────────────────────────────────────────────────

interface BaseRow {
	name: string;
	appName: string;
	env: string | null;
	dockerImage: string;
	databasePassword: string;
	externalPort: number | null;
	command: string | null;
	memoryReservation: string | null;
	memoryLimit: string | null;
	cpuReservation: string | null;
	cpuLimit: string | null;
	environmentId: string;
	serverId: string | null;
}

export interface DatabaseTypeConfig<TRow extends BaseRow> {
	/** Default official image used when the row leaves `dockerImage` empty. */
	defaultImage: string;
	/** Port the database listens on inside the container. */
	internalPort: number;
	/** Container path the `<appName>-data` volume is mounted at. */
	dataDir: string;
	/** Credential env vars consumed by the official image's entrypoint. */
	containerEnv(row: TRow): Record<string, string>;
	/**
	 * Extra args appended to the image entrypoint when the row has no custom
	 * `command` (e.g. the redis `--requirepass` wrapper).
	 */
	defaultArgs(row: TRow): string[];
	/** Build a connection URL for this database type. */
	connectionUrl(row: TRow, host: string, port: number): string;
}

const encode = encodeURIComponent;

/**
 * Major Postgres version of an image ref (`postgres:18.1-alpine` → 18,
 * `timescale/timescaledb:2.17-pg17` → 17). `null` when the tag carries no
 * version (`latest`, digest-only refs, custom names).
 */
export function postgresMajorVersion(image: string): number | null {
	const lastSlash = image.lastIndexOf("/");
	const nameAndTag = lastSlash === -1 ? image : image.slice(lastSlash + 1);
	const colon = nameAndTag.indexOf(":");
	if (colon === -1) return null;
	const tag = nameAndTag.slice(colon + 1).split("@")[0] ?? "";
	const pgTag = tag.match(/(?:^|[^a-z0-9])pg(\d+)(?:$|[^0-9])/i);
	if (pgTag) return Number.parseInt(pgTag[1] as string, 10);
	const leading = tag.match(/^(\d+)/);
	return leading ? Number.parseInt(leading[1] as string, 10) : null;
}

/** Data dir the postgres container is told to use (mounted volume root). */
const POSTGRES_DATA_DIR = "/var/lib/postgresql/data";

/**
 * postgres:18+ moved the image VOLUME to `/var/lib/postgresql` with
 * `PGDATA=/var/lib/postgresql/18/docker`, i.e. outside our
 * `/var/lib/postgresql/data` mount — a redeploy would start on an empty
 * cluster. Pinning PGDATA under the mount keeps the data on the named volume
 * for every version (the official 18 docs recommend a subdirectory).
 * Versions < 18 keep their historical default (`PGDATA` = mount root) so
 * existing clusters are untouched; unversioned tags resolve to the current
 * major (18+) behaviour.
 */
export function postgresPgdata(image: string): string | null {
	const major = postgresMajorVersion(image);
	if (major !== null && major < 18) return null;
	return `${POSTGRES_DATA_DIR}/pgdata`;
}

const POSTGRES_DEFAULT_IMAGE = "postgres:17";

/**
 * Indexed by {@link DatabaseKind} so `DATABASE_CONFIGS[kind]` with a generic
 * `K extends DatabaseKind` yields `DatabaseTypeConfig<DatabaseRowMap[K]>`
 * (an explicit per-key annotation would widen lookups to a union of configs).
 */
export const DATABASE_CONFIGS: { [K in DatabaseKind]: DatabaseTypeConfig<DatabaseRowMap[K]> } = {
	postgres: {
		defaultImage: POSTGRES_DEFAULT_IMAGE,
		internalPort: 5432,
		dataDir: POSTGRES_DATA_DIR,
		containerEnv: (row) => {
			const pgdata = postgresPgdata(row.dockerImage || POSTGRES_DEFAULT_IMAGE);
			return {
				POSTGRES_DB: row.databaseName,
				POSTGRES_USER: row.databaseUser,
				POSTGRES_PASSWORD: row.databasePassword,
				...(pgdata ? { PGDATA: pgdata } : {}),
			};
		},
		defaultArgs: () => [],
		connectionUrl: (row, host, port) =>
			`postgresql://${encode(row.databaseUser)}:${encode(row.databasePassword)}@${host}:${port}/${row.databaseName}`,
	},
	mysql: {
		defaultImage: "mysql:9",
		internalPort: 3306,
		dataDir: "/var/lib/mysql",
		containerEnv: (row) => ({
			MYSQL_DATABASE: row.databaseName,
			MYSQL_USER: row.databaseUser,
			MYSQL_PASSWORD: row.databasePassword,
			MYSQL_ROOT_PASSWORD: row.databaseRootPassword,
		}),
		defaultArgs: () => [],
		connectionUrl: (row, host, port) =>
			`mysql://${encode(row.databaseUser)}:${encode(row.databasePassword)}@${host}:${port}/${row.databaseName}`,
	},
	mariadb: {
		defaultImage: "mariadb:11",
		internalPort: 3306,
		dataDir: "/var/lib/mysql",
		containerEnv: (row) => ({
			MARIADB_DATABASE: row.databaseName,
			MARIADB_USER: row.databaseUser,
			MARIADB_PASSWORD: row.databasePassword,
			MARIADB_ROOT_PASSWORD: row.databaseRootPassword,
		}),
		defaultArgs: () => [],
		connectionUrl: (row, host, port) =>
			`mariadb://${encode(row.databaseUser)}:${encode(row.databasePassword)}@${host}:${port}/${row.databaseName}`,
	},
	mongo: {
		defaultImage: "mongo:8",
		internalPort: 27017,
		dataDir: "/data/db",
		containerEnv: (row) => ({
			MONGO_INITDB_ROOT_USERNAME: row.databaseUser,
			MONGO_INITDB_ROOT_PASSWORD: row.databasePassword,
		}),
		// Replica sets are not supported: `--replSet` with root credentials
		// requires a keyFile plus `rs.initiate()` the engine does not
		// provision, so mongod refuses to start. The legacy `replicaSet`
		// column is ignored (the router rejects setting it).
		defaultArgs: () => [],
		connectionUrl: (row, host, port) =>
			`mongodb://${encode(row.databaseUser)}:${encode(row.databasePassword)}@${host}:${port}/?authSource=admin`,
	},
	redis: {
		defaultImage: "redis:8-alpine",
		internalPort: 6379,
		dataDir: "/data",
		// Password stays in Env (not Args) so `docker inspect` / `ps` do not
		// print `--requirepass <secret>` on the process argv surface.
		containerEnv: (row) => ({ REDIS_PASSWORD: row.databasePassword }),
		defaultArgs: () => [
			"sh",
			"-c",
			'exec redis-server --requirepass "$REDIS_PASSWORD" --appendonly yes',
		],
		connectionUrl: (row, host, port) =>
			`redis://:${encode(row.databasePassword)}@${host}:${port}/0`,
	},
};

/**
 * Dump/restore metadata per database type, consumed by the backups module.
 * Commands are meant to run inside the database container, e.g. via
 * `docker exec <container> sh -c '<cmd>'`. Placeholders:
 * - `{file}`     — absolute path of the dump file inside the container
 * - `{password}` — decrypted database password (only needed where no env var
 *                  carries it, i.e. redis)
 * Credential env vars referenced by the commands are set by the engine at
 * service creation time (see {@link DATABASE_CONFIGS}).
 */
export interface DumpConfig {
	dumpCmd: string;
	restoreCmd: string;
	fileExt: string;
}

export const DB_DUMP_CONFIG: Record<DatabaseKind, DumpConfig> = {
	postgres: {
		dumpCmd: 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f {file}',
		restoreCmd: 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists {file}',
		fileExt: ".dump",
	},
	mysql: {
		dumpCmd:
			'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick "$MYSQL_DATABASE" > {file}',
		restoreCmd: 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < {file}',
		fileExt: ".sql",
	},
	mariadb: {
		dumpCmd:
			'mariadb-dump -u root -p"$MARIADB_ROOT_PASSWORD" --single-transaction --quick "$MARIADB_DATABASE" > {file}',
		restoreCmd: 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" < {file}',
		fileExt: ".sql",
	},
	mongo: {
		dumpCmd:
			'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive={file} --gzip',
		restoreCmd:
			'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive={file} --gzip --drop',
		fileExt: ".archive.gz",
	},
	redis: {
		dumpCmd: "redis-cli -a {password} --rdb {file}",
		// Restoring an RDB requires overwriting /data/dump.rdb and bouncing redis.
		restoreCmd: "cp {file} /data/dump.rdb && (redis-cli -a {password} shutdown nosave || true)",
		fileExt: ".rdb",
	},
};

// ── small helpers ───────────────────────────────────────────────────────────

const docker = new Docker();

const isRemote = (serverId: string | null | undefined): serverId is string =>
	typeof serverId === "string" && serverId.length > 0;

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Split a command string into args, honoring single/double quotes. */
function splitArgs(command: string): string[] {
	const args: string[] = [];
	for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		args.push(match[1] ?? match[2] ?? (match[3] as string));
	}
	return args;
}

/** Parse `KEY=VALUE` lines (the service-level extra env) into `KEY=VALUE` entries. */
function parseEnvLines(env: string | null): string[] {
	if (!env) return [];
	return env
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="));
}

/** Parse a memory string ("512m", "1g", "256MB", plain bytes) into bytes. */
function parseMemory(value: string | null): number | undefined {
	if (!value) return undefined;
	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)\s*(b|kb?|mb?|gb?)?$/);
	if (!match) return undefined;
	const amount = Number.parseFloat(match[1] as string);
	const unit = match[2] ?? "b";
	const multiplier =
		unit === "gb" || unit === "g"
			? 1024 ** 3
			: unit === "mb" || unit === "m"
				? 1024 ** 2
				: unit === "kb" || unit === "k"
					? 1024
					: 1;
	return Math.floor(amount * multiplier);
}

/** Parse a CPU string ("0.5", "2", "500m") into swarm NanoCPUs. */
function parseCpu(value: string | null): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim().toLowerCase();
	const cores = trimmed.endsWith("m")
		? Number.parseFloat(trimmed.slice(0, -1)) / 1000
		: Number.parseFloat(trimmed);
	if (!Number.isFinite(cores) || cores <= 0) return undefined;
	return Math.floor(cores * 1e9);
}

// ── spec building ───────────────────────────────────────────────────────────

interface ServiceDefinition {
	name: string;
	image: string;
	env: string[];
	args: string[];
	volumeName: string;
	dataDir: string;
	publishedPort: number | null;
	targetPort: number;
	memoryReservation?: number;
	memoryLimit?: number;
	cpuReservation?: number;
	cpuLimit?: number;
	kind: DatabaseKind;
}

function buildServiceDefinition<K extends DatabaseKind>(
	kind: K,
	row: DatabaseRowMap[K],
): ServiceDefinition {
	const config = DATABASE_CONFIGS[kind];
	const base = row as BaseRow;
	const credentialEnv = Object.entries(config.containerEnv(row)).map(([k, v]) => `${k}=${v}`);
	const args = base.command ? splitArgs(base.command) : config.defaultArgs(row);
	if (base.externalPort != null) {
		assertSafePublishedPort(base.externalPort, "externalPort");
	}

	return {
		name: base.appName,
		image: base.dockerImage || config.defaultImage,
		env: [...credentialEnv, ...parseEnvLines(base.env), "TZ=UTC"],
		args,
		volumeName: `${base.appName}-data`,
		dataDir: config.dataDir,
		publishedPort: base.externalPort,
		targetPort: config.internalPort,
		memoryReservation: parseMemory(base.memoryReservation),
		memoryLimit: parseMemory(base.memoryLimit),
		cpuReservation: parseCpu(base.cpuReservation),
		cpuLimit: parseCpu(base.cpuLimit),
		kind,
	};
}

function toSwarmSpec(def: ServiceDefinition, replicas: number): Record<string, unknown> {
	const limits: Record<string, number> = {};
	if (def.memoryLimit !== undefined) limits.MemoryBytes = def.memoryLimit;
	if (def.cpuLimit !== undefined) limits.NanoCPUs = def.cpuLimit;
	const reservations: Record<string, number> = {};
	if (def.memoryReservation !== undefined) reservations.MemoryBytes = def.memoryReservation;
	if (def.cpuReservation !== undefined) reservations.NanoCPUs = def.cpuReservation;

	return {
		Name: def.name,
		Labels: {
			"nixploy.managed": "true",
			"nixploy.service.type": def.kind,
		},
		TaskTemplate: {
			ContainerSpec: {
				Image: def.image,
				Env: def.env,
				...(def.args.length > 0 ? { Args: def.args } : {}),
				Mounts: [
					{
						Type: "volume",
						Source: def.volumeName,
						Target: def.dataDir,
						VolumeOptions: {
							NoCopy: false,
							DriverConfig: { Name: "local" },
							Labels: { "nixploy.managed": "true" },
						},
					},
				],
			},
			Resources: {
				...(Object.keys(limits).length > 0 ? { Limits: limits } : {}),
				...(Object.keys(reservations).length > 0 ? { Reservations: reservations } : {}),
			},
			Networks: [{ Target: getSwarmNetwork() }],
			RestartPolicy: { Condition: "any" },
		},
		Mode: { Replicated: { Replicas: replicas } },
		...(def.publishedPort
			? {
					EndpointSpec: {
						Mode: "vip",
						Ports: [
							{
								Protocol: "tcp",
								PublishedPort: def.publishedPort,
								TargetPort: def.targetPort,
								PublishMode: "host",
							},
						],
					},
				}
			: {}),
	};
}

function toCreateCommand(def: ServiceDefinition, replicas: number): string {
	const parts: string[] = [
		"docker service create",
		"--name",
		shellQuote(def.name),
		"--label",
		shellQuote("nixploy.managed=true"),
		"--label",
		shellQuote(`nixploy.service.type=${def.kind}`),
		"--network",
		getSwarmNetwork(),
		"--restart-condition",
		"any",
		"--replicas",
		String(replicas),
		"--mount",
		shellQuote(`type=volume,source=${def.volumeName},target=${def.dataDir}`),
	];
	for (const envPair of def.env) {
		parts.push("--env", shellQuote(envPair));
	}
	if (def.publishedPort) {
		parts.push(
			"--publish",
			shellQuote(`mode=host,published=${def.publishedPort},target=${def.targetPort},protocol=tcp`),
		);
	}
	if (def.memoryLimit !== undefined) parts.push("--limit-memory", String(def.memoryLimit));
	if (def.memoryReservation !== undefined)
		parts.push("--reserve-memory", String(def.memoryReservation));
	if (def.cpuLimit !== undefined) parts.push("--limit-cpu", String(def.cpuLimit / 1e9));
	if (def.cpuReservation !== undefined)
		parts.push("--reserve-cpu", String(def.cpuReservation / 1e9));
	parts.push(shellQuote(def.image));
	for (const arg of def.args) {
		parts.push(shellQuote(arg));
	}
	return parts.join(" ");
}

// ── network ─────────────────────────────────────────────────────────────────

async function ensureNetwork(serverId: string | null): Promise<void> {
	if (isRemote(serverId)) {
		await execAsyncRemote(
			serverId,
			`docker network inspect ${getSwarmNetwork()} >/dev/null 2>&1 || docker network create --driver overlay --attachable ${getSwarmNetwork()}`,
		);
		return;
	}
	const networks = await docker.listNetworks({ filters: { name: [getSwarmNetwork()] } });
	const exists = networks.some((n) => n.Name === getSwarmNetwork());
	if (!exists) {
		await docker.createNetwork({
			Name: getSwarmNetwork(),
			Driver: "overlay",
			Attachable: true,
		});
	}
}

// ── service inspect / status ────────────────────────────────────────────────

export interface ServiceState {
	exists: boolean;
	desired: number;
	running: number;
	/** Tasks swarm is still placing or starting. */
	pending: number;
	/** Tasks that failed or were rejected (crash-loop signal). */
	failed: number;
}

const NO_SERVICE: ServiceState = { exists: false, desired: 0, running: 0, pending: 0, failed: 0 };

/** Swarm task states on their way to running (engine task lifecycle). */
const PENDING_TASK_STATES = new Set([
	"new",
	"pending",
	"assigned",
	"accepted",
	"preparing",
	"starting",
]);
/** Terminal failure states. `shutdown`/`complete` are normal lifecycle
 * (scale-down, rolling update) and must NOT count as failures. */
const FAILED_TASK_STATES = new Set(["failed", "rejected"]);

/** Reduce raw task states into running/pending/failed counts. */
export function summarizeTaskStates(
	states: string[],
): Pick<ServiceState, "running" | "pending" | "failed"> {
	let running = 0;
	let pending = 0;
	let failed = 0;
	for (const state of states) {
		if (state === "running") running += 1;
		else if (PENDING_TASK_STATES.has(state)) pending += 1;
		else if (FAILED_TASK_STATES.has(state)) failed += 1;
	}
	return { running, pending, failed };
}

export async function inspectServiceState(
	appName: string,
	serverId: string | null,
): Promise<ServiceState> {
	if (isRemote(serverId)) {
		// Desired replicas come from `service ls` ("1/1"); live task states from
		// `service ps` — the replica counter alone cannot distinguish "starting"
		// from "crash-looping".
		const out = await execAsyncRemote(
			serverId,
			`docker service ls --filter ${shellQuote(`name=${appName}`)} --format '{{.Name}} {{.Replicas}}'`,
		);
		let desired: number | null = null;
		for (const line of out.split("\n")) {
			const [name, replicas] = line.trim().split(/\s+/);
			if (name === appName && replicas) {
				desired = Number.parseInt(replicas.split("/")[1] ?? "0", 10) || 0;
				break;
			}
		}
		if (desired === null) return NO_SERVICE;

		const ps = await execAsyncRemote(
			serverId,
			`docker service ps ${shellQuote(appName)} --format '{{.CurrentState}}'`,
		);
		// CurrentState looks like "Running 4 minutes ago" — the first word is
		// the task state. Historical (shutdown) rows are ignored by the counter.
		const states = ps
			.split("\n")
			.map((line) => line.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
			.filter(Boolean);
		return { exists: true, desired, ...summarizeTaskStates(states) };
	}

	const services = await docker.listServices({ filters: { name: [appName] } });
	const service = services.find((s) => s.Spec?.Name === appName);
	if (!service) {
		return NO_SERVICE;
	}
	// NOTE: `ServiceStatus` on listServices is only populated with
	// `status: true`; counting tasks directly is both simpler and exact.
	const desired = service.Spec?.Mode?.Replicated?.Replicas ?? 0;
	const tasks = await docker.listTasks({ filters: { service: [appName] } });
	return {
		exists: true,
		desired,
		...summarizeTaskStates(tasks.map((task) => task.Status?.State?.toLowerCase() ?? "")),
	};
}

// ── ownership guard ─────────────────────────────────────────────────────────

/** Labels stamped on every swarm service the engine creates. */
export const MANAGED_LABEL = "nixploy.managed";
export const SERVICE_TYPE_LABEL = "nixploy.service.type";

/**
 * Whether a swarm service's labels identify it as an engine-managed database
 * of `kind` (any kind when omitted). Platform services (`nixploy-postgres`)
 * and application services carry no such label.
 */
export function isManagedDatabaseLabels(
	labels: Record<string, string> | null | undefined,
	kind?: DatabaseKind,
): boolean {
	if (labels?.[MANAGED_LABEL] !== "true") return false;
	const type = labels[SERVICE_TYPE_LABEL];
	if (!type || !(type in DATABASE_CONFIGS)) return false;
	return kind ? type === kind : true;
}

/**
 * Refuse to update/remove a swarm service the engine did not create — a row
 * whose appName collides with the platform's own Postgres or another
 * tenant's application must never replace or delete that service.
 */
async function assertManagedDatabaseService(
	appName: string,
	serverId: string | null,
	kind: DatabaseKind | undefined,
	action: "update" | "remove",
): Promise<void> {
	let labels: Record<string, string> | null | undefined;
	if (isRemote(serverId)) {
		const out = await execAsyncRemote(
			serverId,
			`docker service inspect --format '{{json .Spec.Labels}}' ${shellQuote(appName)} 2>/dev/null || true`,
		);
		const trimmed = out.trim();
		if (!trimmed) return; // no such service — nothing to protect
		try {
			labels = JSON.parse(trimmed) as Record<string, string> | null;
		} catch {
			labels = null;
		}
	} else {
		const existing = await docker
			.getService(appName)
			.inspect()
			.catch(() => null);
		if (!existing) return;
		labels = existing.Spec?.Labels as Record<string, string> | undefined;
	}
	if (!isManagedDatabaseLabels(labels, kind)) {
		throw new Error(
			`Refusing to ${action} swarm service "${appName}": it is not a Nixploy-managed ${kind ?? "database"} service`,
		);
	}
}

// ── public engine API ───────────────────────────────────────────────────────

/** Whether a swarm service for this database exists on the target server. */
export async function databaseServiceExists(
	appName: string,
	serverId: string | null,
): Promise<boolean> {
	return (await inspectServiceState(appName, serverId)).exists;
}

/**
 * Create or update the swarm service for a database. On update the current
 * replica count is preserved; on create the service starts with 1 replica.
 */
export async function deployDatabase<K extends DatabaseKind>(
	kind: K,
	row: DatabaseRowMap[K],
): Promise<void> {
	const def = buildServiceDefinition(kind, row);
	await ensureNetwork(row.serverId);
	await assertManagedDatabaseService(def.name, row.serverId, kind, "update");

	if (isRemote(row.serverId)) {
		// `docker service update` cannot re-key mounts/env atomically; a
		// remove+create is the reliable path over the CLI (Dokploy does the
		// same for remote database rebuilds).
		const state = await inspectServiceState(def.name, row.serverId);
		const replicas = state.exists ? state.desired : 1;
		if (state.exists) {
			await execAsyncRemote(row.serverId, `docker service rm ${shellQuote(def.name)}`);
		}
		await execAsyncRemote(row.serverId, toCreateCommand(def, replicas));
		return;
	}

	const service = docker.getService(def.name);
	const existing = await service.inspect().catch(() => null);
	if (existing) {
		const replicas = existing.Spec?.Mode?.Replicated?.Replicas ?? 1;
		await service.update({
			// biome-ignore lint/suspicious/noExplicitAny: dockerode update takes version + full spec
			...(toSwarmSpec(def, replicas) as any),
			version: existing.Version.Index,
		});
	} else {
		// biome-ignore lint/suspicious/noExplicitAny: dockerode createService accepts the raw Engine API spec
		await docker.createService(toSwarmSpec(def, 1) as any);
	}
}

/** Scale the service to 1 replica (deploying it first if it does not exist). */
export async function startDatabase<K extends DatabaseKind>(
	kind: K,
	row: DatabaseRowMap[K],
): Promise<void> {
	await deployDatabase(kind, row);
	await scaleDatabase(row.appName, row.serverId, 1);
}

/** Scale the service to 0 replicas (keeps service + volume for restarts). */
export async function stopDatabase(appName: string, serverId: string | null): Promise<void> {
	await scaleDatabase(appName, serverId, 0);
}

async function scaleDatabase(
	appName: string,
	serverId: string | null,
	replicas: number,
): Promise<void> {
	if (isRemote(serverId)) {
		if (!(await databaseServiceExists(appName, serverId))) {
			// Scaling a service that was never deployed: stopping is a no-op,
			// starting must go through deploy first.
			if (replicas === 0) return;
			throw new Error(`Service "${appName}" does not exist; deploy it first`);
		}
		await execAsyncRemote(serverId, `docker service scale ${shellQuote(appName)}=${replicas}`);
		return;
	}
	const service = docker.getService(appName);
	const existing = await service.inspect().catch((error: unknown) => {
		if (
			typeof error === "object" &&
			error !== null &&
			(error as { statusCode?: number }).statusCode === 404
		) {
			return null;
		}
		throw error;
	});
	if (!existing) {
		if (replicas === 0) return;
		throw new Error(`Service "${appName}" does not exist; deploy it first`);
	}
	const spec = existing.Spec ?? {};
	spec.Mode = { Replicated: { Replicas: replicas } };
	await service.update({
		// biome-ignore lint/suspicious/noExplicitAny: dockerode update takes version + full spec
		...(spec as any),
		version: existing.Version.Index,
	});
}

/** How long to wait for the last task container to leave after `service rm`. */
const REMOVE_TASK_WAIT_MS = 30_000;
const REMOVE_VOLUME_ATTEMPTS = 5;
const REMOVE_VOLUME_RETRY_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Remove the swarm service and its `<appName>-data` volume. Idempotent.
 *
 * `docker service rm` returns before the task container has stopped; a
 * `volume rm` issued immediately fails with "volume is in use" and the data
 * volume stays orphaned. So: wait (bounded) until no task container with
 * the service label remains, then remove the volume with a few retries.
 * `kind` (when known) tightens the ownership guard — a service the engine
 * did not create is never touched.
 */
export async function removeDatabase(
	appName: string,
	serverId: string | null,
	kind?: DatabaseKind,
): Promise<void> {
	const volumeName = `${appName}-data`;
	await assertManagedDatabaseService(appName, serverId, kind, "remove");
	if (isRemote(serverId)) {
		const label = shellQuote(`label=com.docker.swarm.service.name=${appName}`);
		await execAsyncRemote(
			serverId,
			[
				`docker service rm ${shellQuote(appName)} >/dev/null 2>&1 || true`,
				`i=0; while [ "$i" -lt ${Math.floor(REMOVE_TASK_WAIT_MS / 1000)} ] && [ -n "$(docker ps -aq --filter ${label} 2>/dev/null)" ]; do sleep 1; i=$((i+1)); done`,
				`if docker volume inspect ${shellQuote(volumeName)} >/dev/null 2>&1; then i=0; until docker volume rm ${shellQuote(volumeName)} >/dev/null 2>&1 || [ "$i" -ge ${REMOVE_VOLUME_ATTEMPTS} ]; do sleep ${Math.floor(REMOVE_VOLUME_RETRY_MS / 1000)}; i=$((i+1)); done; fi`,
				"true",
			].join("; "),
		);
		return;
	}
	await docker
		.getService(appName)
		.remove()
		.catch(() => undefined);

	const deadline = Date.now() + REMOVE_TASK_WAIT_MS;
	while (Date.now() < deadline) {
		const remaining = await docker
			.listContainers({
				all: true,
				filters: { label: [`com.docker.swarm.service.name=${appName}`] },
			})
			.catch(() => []);
		if (remaining.length === 0) break;
		await sleep(1_000);
	}

	const volume = docker.getVolume(volumeName);
	const exists = await volume
		.inspect()
		.then(() => true)
		.catch(() => false);
	if (!exists) return;
	for (let attempt = 1; attempt <= REMOVE_VOLUME_ATTEMPTS; attempt++) {
		try {
			await volume.remove();
			return;
		} catch (error) {
			const status = (error as { statusCode?: number }).statusCode;
			if (status === 404) return;
			if (attempt === REMOVE_VOLUME_ATTEMPTS) {
				throw new Error(
					`Removed service "${appName}" but its data volume "${volumeName}" is still in use — remove it manually`,
				);
			}
			await sleep(REMOVE_VOLUME_RETRY_MS);
		}
	}
}

/** Force a rolling re-creation of the service's tasks (re-pull + restart). */
export async function reloadDatabase(appName: string, serverId: string | null): Promise<void> {
	if (isRemote(serverId)) {
		await execAsyncRemote(serverId, `docker service update --force ${shellQuote(appName)}`);
		return;
	}
	const service = docker.getService(appName);
	const existing = await service.inspect();
	const spec = existing.Spec ?? {};
	spec.TaskTemplate = {
		...spec.TaskTemplate,
		ForceUpdate: (spec.TaskTemplate?.ForceUpdate ?? 0) + 1,
	};
	await service.update({
		// biome-ignore lint/suspicious/noExplicitAny: dockerode update takes version + full spec
		...(spec as any),
		version: existing.Version.Index,
	});
}

/**
 * Map a service's task summary to the stored status:
 * - no service or scaled to 0                     → idle
 * - at least one task running                     → running
 * - repeated task failures (crash loop)           → error
 * - one failed task and nothing pending           → error
 * - desired > 0, tasks still being placed/started → running (converging)
 */
export function statusFromServiceState(state: ServiceState): DatabaseStatus {
	if (!state.exists || state.desired === 0) return "idle";
	if (state.running > 0) return "running";
	if (state.failed >= 2) return "error";
	if (state.failed === 1 && state.pending === 0) return "error";
	return "running";
}

/** Live status derived from the swarm service's task states. */
export async function getDatabaseStatus(
	appName: string,
	serverId: string | null,
): Promise<DatabaseStatus> {
	return statusFromServiceState(await inspectServiceState(appName, serverId));
}

/**
 * Build a connection URL for a database row.
 * - internal: host is the swarm service name (resolvable by any container on
 *   `nixploy-network`) with the container's native port.
 * - external: host is the server's IP (or `localhost` for the Nixploy host
 *   itself) with the published `externalPort`; throws when none is set.
 * Passwords come from `encryptedText` columns and are already decrypted when
 * the row is read through Drizzle.
 */
export async function buildConnectionUrl<K extends DatabaseKind>(
	kind: K,
	row: DatabaseRowMap[K],
	options: { external?: boolean } = {},
): Promise<string> {
	const config = DATABASE_CONFIGS[kind];
	if (!options.external) {
		return config.connectionUrl(row, row.appName, config.internalPort);
	}
	if (!row.externalPort) {
		throw new Error(`Database ${row.appName} has no external port configured`);
	}
	let host = "localhost";
	if (isRemote(row.serverId)) {
		const [server] = await db.select().from(servers).where(eq(servers.serverId, row.serverId));
		if (!server) {
			throw new Error(`Server not found: ${row.serverId}`);
		}
		host = server.ipAddress;
	}
	return config.connectionUrl(row, host, row.externalPort);
}
