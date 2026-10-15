import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	type backups,
	compose,
	destinations,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
	type volumeBackups,
} from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { execAsync, execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { assertDockerVolumeName } from "../../utils/validators";
import { shellQuote } from "../compose/paths";
import { DATABASE_CONFIGS, isManagedDatabaseLabels } from "../databases/engine";
import { PROTECTED_VOLUMES } from "../docker/protected";
import { notifyEvent } from "../notifications";
import { getConfigDir } from "../traefik/paths";
import { type ValidatedArchive, withValidatedArchive } from "./archive";
import { DB_DUMP_CONFIG, type DumpCommandParams } from "./dump-commands";
import {
	buildConfigArchiveCommand,
	buildInstanceContainerDumpCommand,
	buildInstanceContainerFilters,
	buildInstancePgDumpCommand,
	buildRedisSnapshotCleanupScript,
	buildRedisSnapshotScript,
	isSafeRedisDataDir,
	parseInstanceDatabaseUrl,
	WEB_SERVER_CONFIG_SUFFIX,
} from "./instance-backup";
import { assertStreamExit, buildStreamPipeline, GzipArchiveCheck } from "./pipeline";
import { withRedisBackupLock } from "./redis-lock";
import { buildVolumeReplacementScript } from "./restore-commands";
import { type BackupRunHandle, type BackupRunTrigger, withBackupRun } from "./runs";
import { type BackupStore, type DestinationRow, storeFor } from "./storage";
import { type StreamingCommand, spawnStreamingCommand } from "./stream-exec";
import { assertSafeTarEntry } from "./tar";
import {
	buildVerifyCleanupCommand,
	buildVerifyContainerName,
	buildVerifyCreateCommand,
	buildVerifyLivenessCommand,
	buildVerifyRestoreCommand,
	buildVerifyRunCommand,
	buildVerifyStartCommand,
	buildVerifyWaitCommand,
	expectedLivenessOutput,
	livenessAnswered,
	type VerifyTarget,
} from "./verify-commands";

const log = createLogger("backups");

/**
 * Backup runner: database dumps and volume archives to a destination
 * (S3-compatible bucket or the panel host's disk — see storage.ts).
 *
 * Transport strategy (works identically for the local Docker daemon and for
 * remote managed servers over SSH): the dump/archive command runs inside a
 * container on the target server and its bytes are gzipped in the same shell
 * pipeline (see pipeline.ts — the producer's exit status is carried along so
 * a failed dump never uploads an empty archive).
 *
 * All backup archives stream: stdout
 * goes straight into an S3 multipart upload (8 MiB parts) or a local file,
 * and a restore streams the stored object back into the container's stdin.
 * Restore pins and validates each selected archive on disk before target
 * writes. Memory is bounded; no archive passes through the buffered exec
 * helper or base64. The producer exit-status trailer travels on stderr.
 *
 * Every run is recorded as a `backup_run` row (runs.ts): `running` while the
 * dump is in flight, then `success` with the object key and size, or
 * `error` with a redacted message.
 */

export type { DestinationRow } from "./storage";
export { getS3Client } from "./storage";
export type BackupRow = typeof backups.$inferSelect;
export type VolumeBackupRow = typeof volumeBackups.$inferSelect;

export interface RunOptions {
	/** Who started the run — recorded on the `backup_run` row. Defaults to `manual`. */
	trigger?: BackupRunTrigger;
}

/** Outcome of a run: the stored key and the archive size in bytes. */
export interface RunResult {
	key: string;
	bytes: number;
}

/** Hard time box of a restore verification (container start + restore + query). */
export const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const run = (serverId: string | null | undefined, command: string, timeoutMs?: number) =>
	serverId
		? execAsyncRemote(serverId, command, { timeoutMs })
		: execAsync(command, { timeout: timeoutMs });

const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;

// ── destinations ────────────────────────────────────────────────────────────

/** Verify a destination: list one object (S3) or write a probe file (local). */
export async function testDestination(destination: DestinationRow): Promise<{ success: true }> {
	await storeFor(destination).test();
	return { success: true };
}

async function findDestinationOrThrow(destinationId: string): Promise<DestinationRow> {
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${destinationId}`);
	}
	return destination;
}

/** Delete every object under `prefix` beyond the newest `keepLatestCount`. */
async function pruneOldBackups(
	store: BackupStore,
	prefix: string,
	keepLatestCount: number | null,
): Promise<void> {
	if (!keepLatestCount || keepLatestCount <= 0) return;
	const keys = await store.list(prefix);
	const excess = keys.slice(0, Math.max(0, keys.length - keepLatestCount));
	if (excess.length === 0) return;
	await store.remove(excess);
}

/** `<prefix>/<appName>/<ISO-timestamp>.gz` (contract layout). */
export function buildBackupKey(prefix: string, appName: string, date = new Date()): string {
	const timestamp = date.toISOString().replace(/[:.]/g, "-");
	return `${prefix}/${appName}/${timestamp}.gz`;
}

const backupPrefix = (backupRow: BackupRow) => `${backupRow.prefix}/${backupRow.appName}/`;
const volumePrefix = (volumeBackup: VolumeBackupRow) =>
	`${volumeBackup.prefix}/${volumeBackup.volumeName}/`;

// ── database dumps ──────────────────────────────────────────────────────────

type LinkedDatabaseRow = {
	serverId: string | null;
	databaseUser: string;
	databasePassword: string;
	databaseRootPassword?: string | null;
	dockerImage: string;
};

/** Load the database service row a backup row points at (exactly one FK is set). */
async function findLinkedDatabase(backupRow: BackupRow): Promise<LinkedDatabaseRow> {
	switch (backupRow.databaseType) {
		case "postgres": {
			if (!backupRow.postgresId) break;
			const row = await db.query.postgres.findFirst({
				where: eq(postgres.postgresId, backupRow.postgresId),
			});
			if (row) return row;
			break;
		}
		case "mysql": {
			if (!backupRow.mysqlId) break;
			const row = await db.query.mysql.findFirst({
				where: eq(mysql.mysqlId, backupRow.mysqlId),
			});
			if (row) return row;
			break;
		}
		case "mariadb": {
			if (!backupRow.mariadbId) break;
			const row = await db.query.mariadb.findFirst({
				where: eq(mariadb.mariadbId, backupRow.mariadbId),
			});
			if (row) return row;
			break;
		}
		case "mongo": {
			if (!backupRow.mongoId) break;
			const row = await db.query.mongo.findFirst({
				where: eq(mongo.mongoId, backupRow.mongoId),
			});
			if (row) return row;
			break;
		}
		case "redis": {
			if (!backupRow.redisId) break;
			const row = await db.query.redis.findFirst({
				where: eq(redis.redisId, backupRow.redisId),
			});
			// Redis services have no user — AUTH is password-only.
			if (row)
				return {
					serverId: row.serverId,
					databaseUser: "",
					databasePassword: row.databasePassword,
					dockerImage: row.dockerImage,
				};
			break;
		}
	}
	throw new Error(
		`Backup ${backupRow.backupId}: no linked ${backupRow.databaseType} database found`,
	);
}

/**
 * Whether the database service a backup row points at still exists. Used by
 * the scheduler to drop cron jobs whose service was deleted underneath them
 * (rows cascade, but a captured row keeps firing otherwise).
 */
export async function backupServiceExists(backupRow: BackupRow): Promise<boolean> {
	if (backupRow.databaseType === "web-server") return true;
	try {
		await findLinkedDatabase(backupRow);
		return true;
	} catch {
		return false;
	}
}

async function findContainerId(appName: string, serverId: string | null): Promise<string> {
	const filters = [
		`--filter ${shellQuote(`label=com.docker.swarm.service.name=${appName}`)}`,
		`--filter ${shellQuote(`label=com.docker.compose.project=${appName}`)}`,
		`--filter ${shellQuote(`label=com.docker.stack.namespace=${appName}`)}`,
	];
	for (const filter of filters) {
		const output = await run(serverId, `docker ps -q ${filter} | head -n 1`);
		const containerId = output.trim().split("\n")[0]?.trim();
		if (containerId) {
			if (!CONTAINER_ID_PATTERN.test(containerId)) {
				throw new Error(`Unexpected container id for ${appName}`);
			}
			return containerId;
		}
	}
	throw new Error(`No running container found for ${appName}`);
}

function dumpParams(backupRow: BackupRow, linked: LinkedDatabaseRow): DumpCommandParams {
	return {
		database: backupRow.database,
		databaseUser: linked.databaseUser,
		databasePassword: linked.databasePassword,
		databaseRootPassword: linked.databaseRootPassword ?? null,
	};
}

const runKindFor = (backupRow: BackupRow) =>
	backupRow.databaseType === "web-server" ? ("instance" as const) : ("database" as const);

/**
 * Run a database dump and store it in the row's destination. Recorded as a
 * `backup_run` row. Returns the key of the stored archive and its size.
 */
export async function runBackup(
	backupRow: BackupRow,
	options: RunOptions = {},
): Promise<RunResult> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	return await withBackupRun(
		{
			kind: runKindFor(backupRow),
			scope: { backupId: backupRow.backupId },
			organizationId: destination.organizationId,
			destinationId: destination.destinationId,
			trigger: options.trigger ?? "manual",
			secrets: [destination.accessKey, destination.secretAccessKey],
		},
		async (handle) => {
			const store = storeFor(destination);
			if (backupRow.databaseType === "web-server") {
				return await runWebServerBackup(backupRow, store, handle);
			}
			if (backupRow.databaseType === "redis") {
				return await runRedisBackup(backupRow, store, handle);
			}
			return await runDatabaseDump(backupRow, store, handle);
		},
	);
}

async function runDatabaseDump(
	backupRow: BackupRow,
	store: BackupStore,
	handle: BackupRunHandle,
): Promise<RunResult> {
	if (backupRow.databaseType === "web-server" || backupRow.databaseType === "redis") {
		throw new Error(`Unsupported dump engine: ${backupRow.databaseType}`);
	}
	const engine = DB_DUMP_CONFIG[backupRow.databaseType];
	const linked = await findLinkedDatabase(backupRow);
	handle.redact(linked.databasePassword, linked.databaseRootPassword);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);

	const params = dumpParams(backupRow, linked);
	const dumpCommand = engine.dumpCommand(params);
	const passwordEnv = engine.passwordEnv?.(params) ?? {};
	const passwordEntries = Object.entries(passwordEnv);

	let command: string;
	let stdin: string | undefined;
	if (passwordEntries.length > 0) {
		// Password on stdin (first line) — never on docker/ps argv.
		const exports = passwordEntries.map(([key]) => key).join(" ");
		const reader = passwordEntries.map(([key]) => `IFS= read -r ${key}`).join("; ");
		const inner = `${reader}; export ${exports}; ${dumpCommand}`;
		command = buildStreamPipeline(`docker exec -i ${shellQuote(containerId)} sh -c ${sq(inner)}`);
		stdin = `${passwordEntries.map(([, v]) => v).join("\n")}\n`;
	} else {
		command = buildStreamPipeline(
			`docker exec ${shellQuote(containerId)} sh -c ${sq(dumpCommand)}`,
		);
	}

	const label = `Dump of ${backupRow.appName}`;
	const key = buildBackupKey(backupRow.prefix, backupRow.appName);
	// A backup triggered right after the service started (first deploy, a
	// restart, the CI golden path) meets a database that is still initialising
	// its data directory or not yet accepting connections. The dump itself is
	// the readiness probe: a "starting up" failure is retried for a bounded
	// window instead of failing the run. A failed attempt never reaches the
	// store's finalize step, so nothing partial is left behind.
	const deadline = Date.now() + databaseReadyTimeoutMs();
	for (let attempt = 1; ; attempt++) {
		const proc = await spawnStreamingCommand(linked.serverId, command, { stdin });
		try {
			const bytes = await storeStreamedArchive(store, key, proc, label);
			await pruneOldBackups(store, backupPrefix(backupRow), backupRow.keepLatestCount);
			return { key, bytes };
		} catch (error) {
			if (!isDatabaseStartingError(error) || Date.now() >= deadline) throw error;
			log.info(
				`${label}: database not ready yet (attempt ${attempt}), retrying in ${DATABASE_READY_POLL_MS / 1000}s`,
			);
			await new Promise((resolve) => setTimeout(resolve, DATABASE_READY_POLL_MS));
		}
	}
}

/** How long a dump keeps retrying a database that is still starting (default 90 s). */
export const DEFAULT_DATABASE_READY_TIMEOUT_MS = 90_000;
const DATABASE_READY_POLL_MS = 5_000;

export function databaseReadyTimeoutMs(): number {
	const fromEnv = Number.parseInt(process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_DATABASE_READY_TIMEOUT_MS;
}

/**
 * Does a failed dump look like "the database is not up yet" rather than a
 * real dump problem? Matched against the producer's stderr that
 * `assertStreamExit` folds into the error message.
 */
export function isDatabaseStartingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /starting up|shutting down|connection refused|could not connect|can't connect|cannot connect|ECONNREFUSED|not yet accept|is the server running|MongoNetworkError|MongoServerSelectionError|Connection reset|No such file or directory.*\.s\.PGSQL|Lost connection/i.test(
		message,
	);
}

/**
 * Pipe a streaming dump into the destination. The exit-status trailer and the
 * gzip shape are checked at the END of the source generator, i.e. BEFORE the
 * store finalizes (`CompleteMultipartUpload` / `rename`), so a failed dump
 * aborts the upload instead of replacing a good archive with an empty one.
 */
async function storeStreamedArchive(
	store: BackupStore,
	key: string,
	proc: StreamingCommand,
	label: string,
): Promise<number> {
	const shape = new GzipArchiveCheck();
	async function* guarded(): AsyncGenerator<Buffer> {
		try {
			for await (const chunk of proc.stdout) {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
				await shape.update(buffer);
				yield buffer;
			}
			// Throws when the pipeline (or the producer inside it) failed.
			assertStreamExit(await proc.done, label);
			await shape.assert(label);
		} finally {
			shape.abort();
		}
	}
	try {
		return await store.putStream(key, guarded());
	} catch (error) {
		proc.abort();
		throw error;
	}
}

/** Replay a pinned archive; input/read/consumer errors abort the command. */
async function replayArchive(
	archive: ValidatedArchive,
	serverId: string | null | undefined,
	command: string,
	timeoutMs?: number,
	checkProducer = false,
): Promise<void> {
	const input = archive.open();
	let proc: StreamingCommand | undefined;
	try {
		proc = await spawnStreamingCommand(serverId, command, { stdin: input, timeoutMs });
		for await (const _chunk of proc.stdout) {
			/* drain restore output */
		}
		const stderr = await proc.done;
		if (checkProducer) assertStreamExit(stderr, "Restore decompression");
	} catch (error) {
		proc?.abort();
		throw error;
	} finally {
		input.destroy();
	}
}

/** Validate tar readability without attaching the live target volume. */
async function preflightTar(
	archive: ValidatedArchive,
	serverId: string | null | undefined,
	root?: string,
): Promise<void> {
	const input = archive.open();
	let proc: StreamingCommand | undefined;
	try {
		proc = await spawnStreamingCommand(
			serverId,
			"docker run --rm -i --network none alpine tar tvzf -",
			{ stdin: input },
		);
		let pending = "";
		let entries = 0;
		for await (const chunk of proc.stdout) {
			pending += chunk.toString();
			let end = pending.indexOf("\n");
			while (end !== -1) {
				if (end > 64 * 1024) throw new Error("Archive tar listing line is too long");
				assertSafeTarEntry(pending.slice(0, end), root);
				entries++;
				pending = pending.slice(end + 1);
				end = pending.indexOf("\n");
			}
			if (pending.length > 64 * 1024) throw new Error("Archive tar listing line is too long");
		}
		if (pending) {
			assertSafeTarEntry(pending, root);
			entries++;
		}
		await proc.done;
		if (entries === 0) throw new Error("Archive tar has no entries");
	} catch (error) {
		proc?.abort();
		throw error;
	} finally {
		input.destroy();
	}
}

async function assertStoppedVolume(
	volumeName: string,
	serverId: string | null | undefined,
): Promise<void> {
	await run(serverId, `docker volume inspect ${sq(volumeName)} --format '{{.Name}}'`);
	// A desired-running Swarm service can have no container during restart or
	// placement. Inspect its intent and actual tasks before trusting local ps.
	const serviceIds = (await execAsync("docker service ls --quiet"))
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (serviceIds.some((id) => !/^[a-z0-9]{12,64}$/.test(id)))
		throw new Error("Cannot verify volume consumer identities");
	const services = serviceIds.length
		? (JSON.parse(
				await execAsync(`docker service inspect ${serviceIds.map(sq).join(" ")}`),
			) as Array<{
				Spec?: {
					Name?: string;
					Mode?: { Replicated?: { Replicas?: number } };
					TaskTemplate?: { ContainerSpec?: { Mounts?: Array<{ Type?: string; Source?: string }> } };
				};
			}>)
		: [];
	const consumers = services.filter((service) =>
		service.Spec?.TaskTemplate?.ContainerSpec?.Mounts?.some(
			(mount) => mount.Type === "volume" && mount.Source === volumeName,
		),
	);
	if (consumers.some((service) => service.Spec?.Mode?.Replicated?.Replicas !== 0))
		throw new Error(`Stop every Swarm service using volume ${volumeName} before restoring it`);
	for (const service of consumers) {
		if (!service.Spec?.Name) throw new Error("Cannot verify a volume consumer");
		await waitStoppedTasks(service.Spec.Name, serverId);
	}
	const deadline = Date.now() + 30_000;
	while ((await run(serverId, `docker ps -q --filter ${sq(`volume=${volumeName}`)}`)).trim()) {
		if (Date.now() >= deadline)
			throw new Error(`Stop every container using volume ${volumeName} before restoring it`);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

async function waitStoppedTasks(
	appName: string,
	serverId: string | null | undefined,
): Promise<void> {
	const targetNode = (await run(serverId, "docker info --format '{{.Swarm.NodeID}}'")).trim();
	if (!targetNode) throw new Error("Cannot verify the volume's target node");
	const deadline = Date.now() + 30_000;
	while (true) {
		const ids = (await execAsync(`docker service ps --no-trunc -q ${sq(appName)}`))
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		if (ids.some((id) => !/^[a-z0-9]{20,64}$/.test(id)))
			throw new Error("Cannot verify volume task identities");
		const tasks = ids.length
			? (JSON.parse(await execAsync(`docker inspect ${ids.map(sq).join(" ")}`)) as Array<{
					NodeID?: string;
					Status?: { State?: string };
				}>)
			: [];
		const active = tasks.filter(
			(task) => !["complete", "shutdown", "failed", "rejected"].includes(task.Status?.State ?? ""),
		);
		if (active.some((task) => task.NodeID !== targetNode))
			throw new Error("Cannot verify stopped volume tasks on another node");
		if (active.length === 0) return;
		if (Date.now() >= deadline)
			throw new Error("Volume tasks did not stop within 30 seconds; retry after they stop");
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

/** Keys of every stored dump of a backup row, newest first. */
export async function listBackupKeys(backupRow: BackupRow): Promise<string[]> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const keys = await storeFor(destination).list(backupPrefix(backupRow));
	return keys.reverse();
}

/** Resolve the archive to restore/verify: newest when omitted, must belong to the row. */
async function resolveStoredKey(backupRow: BackupRow, key: string | undefined): Promise<string> {
	const keys = await listBackupKeys(backupRow);
	const targetKey = key ?? keys[0];
	if (!targetKey) {
		throw new Error(`No stored dump found for ${backupRow.appName}`);
	}
	if (!keys.includes(targetKey)) {
		throw new Error(`Dump ${targetKey} does not belong to backup ${backupRow.backupId}`);
	}
	return targetKey;
}

/**
 * Restore a database from a stored dump. Defaults to the newest dump under
 * the backup's prefix when `key` is omitted.
 */
export async function restoreBackup(backupRow: BackupRow, key?: string): Promise<{ key: string }> {
	const databaseType = backupRow.databaseType;
	if (databaseType === "web-server") {
		throw new Error(
			"web-server backups are restored manually (pg_dump archive + config tar.gz) — see docs/instance-backup.md",
		);
	}
	if (databaseType === "redis") {
		return await restoreRedisBackup(backupRow, key);
	}
	const engine = DB_DUMP_CONFIG[databaseType];
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const targetKey = await resolveStoredKey(backupRow, key);

	const store = storeFor(destination);
	const linked = await findLinkedDatabase(backupRow);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);

	const params = dumpParams(backupRow, linked);
	const restoreCommand = engine.restoreCommand(params);
	const passwordEnv = engine.passwordEnv?.(params) ?? {};
	const passwordEntries = Object.entries(passwordEnv);

	return await withValidatedArchive(store, targetKey, async (archive) => {
		const streamRestore = async (inner: string): Promise<void> => {
			await replayArchive(
				archive,
				linked.serverId,
				buildStreamPipeline(
					"gunzip",
					`docker exec -i ${shellQuote(containerId)} sh -c ${sq(inner)}`,
				),
				undefined,
				true,
			);
		};

		if (passwordEntries.length > 0) {
			const passFile = "/tmp/.nixploy-db-pass";
			await execAsyncWithStdin(
				`docker exec -i ${shellQuote(containerId)} sh -c ${sq(`umask 077; cat > ${passFile}`)}`,
				`${passwordEntries.map(([, value]) => value).join("\n")}\n`,
				{ serverId: linked.serverId },
			);
			try {
				const exports = passwordEntries
					.map(([key], index) =>
						index === 0
							? `${key}=$(head -n 1 ${passFile})`
							: `${key}=$(sed -n '${index + 1}p' ${passFile})`,
					)
					.join("; ");
				// Preserve the restore tool's exit status past the cleanup.
				const wrapped = `${exports}; export ${passwordEntries.map(([key]) => key).join(" ")}; ${restoreCommand}; __rc=$?; rm -f ${passFile}; exit $__rc`;
				await streamRestore(wrapped);
			} finally {
				await run(linked.serverId, `docker exec ${shellQuote(containerId)} rm -f ${passFile}`);
			}
		} else {
			await streamRestore(restoreCommand);
		}
		return { key: targetKey };
	});
}

// ── restore verification ────────────────────────────────────────────────────

/** Engine, image and names the throwaway verification container needs. */
async function resolveVerifyTarget(
	backupRow: BackupRow,
): Promise<VerifyTarget & { serverId: string | null }> {
	if (backupRow.databaseType === "web-server") {
		// The instance dump is plain SQL from pg_dump: any current Postgres
		// image restores it; the panel's own DB row does not carry an image.
		const target = parseInstanceDatabaseUrl(process.env.DATABASE_URL);
		return {
			engine: "postgres",
			image: DATABASE_CONFIGS.postgres.defaultImage,
			database: target.database,
			user: target.user,
			serverId: null,
		};
	}
	const linked = await findLinkedDatabase(backupRow);
	const engine = backupRow.databaseType;
	return {
		engine,
		image: linked.dockerImage || DATABASE_CONFIGS[engine].defaultImage,
		database: backupRow.database,
		user: linked.databaseUser,
		serverId: linked.serverId,
	};
}

/** stderr captured by the exec helpers, for readable verification errors. */
function stderrOf(error: unknown): string {
	const stderr = (error as { stderr?: unknown })?.stderr;
	return typeof stderr === "string" ? stderr.trim() : "";
}

/**
 * Verify that a stored dump restores: start a throwaway container of the
 * source service's image (no ports, no network), restore the archive into
 * it, run the engine's liveness query, and always remove the container.
 * Recorded as a `backup_run` row with `trigger: "verify"`; time-boxed to
 * {@link VERIFY_TIMEOUT_MS}. The live database is never touched.
 */
export async function verifyBackup(backupRow: BackupRow, key?: string): Promise<RunResult> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const targetKey = await resolveStoredKey(backupRow, key);
	return await withBackupRun(
		{
			kind: runKindFor(backupRow),
			scope: { backupId: backupRow.backupId },
			organizationId: destination.organizationId,
			destinationId: destination.destinationId,
			trigger: "verify",
			objectKey: targetKey,
			secrets: [destination.accessKey, destination.secretAccessKey],
		},
		async () => {
			return await withValidatedArchive(storeFor(destination), targetKey, async (archive) => {
				const { serverId, ...target } = await resolveVerifyTarget(backupRow);
				const name = buildVerifyContainerName(randomBytes(8).toString("hex"));
				const deadline = Date.now() + VERIFY_TIMEOUT_MS;
				const remaining = () => {
					const left = deadline - Date.now();
					if (left <= 0) {
						throw new Error(`Restore verification exceeded ${VERIFY_TIMEOUT_MS / 60_000} minutes`);
					}
					return left;
				};
				try {
					if (target.engine === "redis") {
						await run(serverId, buildVerifyCreateCommand(name, target), remaining());
						await preflightTar(archive, serverId);
						await replayArchive(
							archive,
							serverId,
							buildVerifyRestoreCommand(name, target),
							remaining(),
							true,
						);
						await run(serverId, buildVerifyStartCommand(name), remaining());
					} else {
						await run(serverId, buildVerifyRunCommand(name, target), remaining());
					}
					try {
						await run(serverId, buildVerifyWaitCommand(name, target), remaining());
					} catch (error) {
						const detail = stderrOf(error);
						throw new Error(
							`${target.engine} container did not become ready${detail ? `: ${detail.slice(-600)}` : ""}`,
						);
					}
					if (target.engine !== "redis") {
						try {
							await replayArchive(
								archive,
								serverId,
								buildVerifyRestoreCommand(name, target),
								remaining(),
								true,
							);
						} catch (error) {
							const detail = stderrOf(error);
							throw new Error(
								`Restore into the verification container failed${detail ? `: ${detail.slice(-600)}` : ""}`,
							);
						}
					}
					const output = await run(serverId, buildVerifyLivenessCommand(name, target), remaining());
					if (!livenessAnswered(target.engine, output)) {
						throw new Error(
							`${target.engine} liveness query answered ${JSON.stringify(output.trim().slice(0, 200))}, expected ${expectedLivenessOutput(target.engine)}`,
						);
					}
					return { key: targetKey, bytes: archive.bytes };
				} finally {
					await run(serverId, buildVerifyCleanupCommand(name)).catch(() => {});
				}
			});
		},
	);
}

// ── instance self-backup (web-server) ───────────────────────────────────────

/**
 * Dump the instance database by shelling out to a Postgres container when
 * the Nixploy process itself has no pg_dump. The DATABASE_URL host is the
 * Swarm service name in production and the compose service name in
 * docker-compose.dev.yml, so the container is found by that name.
 */
async function dumpInstanceFromContainer(
	target: ReturnType<typeof parseInstanceDatabaseUrl>,
): Promise<StreamingCommand> {
	for (const filter of buildInstanceContainerFilters(target.host)) {
		const output = await execAsync(`docker ps -q ${filter} | head -n 1`);
		const containerId = output.trim().split("\n")[0]?.trim();
		if (containerId && CONTAINER_ID_PATTERN.test(containerId)) {
			return await spawnStreamingCommand(
				null,
				buildStreamPipeline(
					`docker exec ${shellQuote(containerId)} sh -c ${sq(buildInstanceContainerDumpCommand(target))}`,
				),
			);
		}
	}
	throw new Error(
		`pg_dump is not available in the Nixploy process and no Postgres container matches the DATABASE_URL host "${target.host}"`,
	);
}

/**
 * Back up the Nixploy instance itself: a pg_dump of the DATABASE_URL
 * database plus a tar.gz of the config directory (Traefik dynamic configs,
 * certificates, SSH keys). Stored as two sibling artifacts —
 * `<prefix>/<appName>/<ts>.gz` and `<prefix>/<appName>-config/<ts>.gz` —
 * so retention prunes each stream independently. Restore is manual
 * (docs/instance-backup.md).
 */
async function runWebServerBackup(
	backupRow: BackupRow,
	store: BackupStore,
	handle: BackupRunHandle,
): Promise<RunResult> {
	const target = parseInstanceDatabaseUrl(process.env.DATABASE_URL);
	handle.redact(target.password);
	const hasLocalPgDump = await execAsync("command -v pg_dump")
		.then(() => true)
		.catch(() => false);
	const date = new Date();
	const dumpKey = buildBackupKey(backupRow.prefix, backupRow.appName, date);
	const configKey = buildBackupKey(
		backupRow.prefix,
		`${backupRow.appName}${WEB_SERVER_CONFIG_SUFFIX}`,
		date,
	);
	let bytes: number;
	try {
		// Publish config first: the SQL key is the discoverable completion marker
		// for the pair. Neither retention stream is pruned on producer failure.
		bytes = await storeStreamedArchive(
			store,
			configKey,
			await spawnStreamingCommand(
				null,
				buildStreamPipeline(buildConfigArchiveCommand(getConfigDir())),
			),
			"Archive of the instance config directory",
		);
		const proc = hasLocalPgDump
			? await spawnStreamingCommand(null, buildStreamPipeline(buildInstancePgDumpCommand(target)), {
					env: { ...process.env, PGPASSWORD: target.password },
				})
			: await dumpInstanceFromContainer(target);
		bytes += await storeStreamedArchive(store, dumpKey, proc, "Dump of the instance database");
	} catch (error) {
		// A failed pair is never advertised as a successful run. Storage outages
		// may prevent cleanup; the SQL completion marker is always written last.
		await store.remove([configKey, dumpKey]).catch(() => {});
		throw error;
	}
	if (backupRow.keepLatestCount && backupRow.keepLatestCount > 0) {
		const keys = await store.list(backupPrefix(backupRow));
		const excess = keys.slice(0, Math.max(0, keys.length - backupRow.keepLatestCount));
		// Prune matching pairs: concurrent producers can finish SQL/config in
		// different orders, so independent mtime retention could split a pair.
		if (excess.length) {
			await store.remove(excess);
			await store.remove(
				excess.map(
					(key) =>
						`${backupRow.prefix}/${backupRow.appName}${WEB_SERVER_CONFIG_SUFFIX}/${key.slice(backupPrefix(backupRow).length)}`,
				),
			);
		}
	}
	return { key: dumpKey, bytes };
}

// ── redis ────────────────────────────────────────────────────────────────────

/**
 * Snapshot a redis service: BGSAVE (or blocking SAVE) inside the container,
 * wait for persistence to finish, then `docker cp` the whole data directory
 * (dump.rdb plus the AOF when appendonly is enabled) into a tar.gz.
 */
async function runRedisBackup(
	backupRow: BackupRow,
	store: BackupStore,
	handle: BackupRunHandle,
): Promise<RunResult> {
	const linked = await findLinkedDatabase(backupRow);
	handle.redact(linked.databasePassword);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);

	if (!backupRow.redisId) throw new Error("Redis backup has no linked service");
	return await withRedisBackupLock(backupRow.redisId, async (signal) => {
		const token = randomBytes(12).toString("hex");
		// The private container marker fences a second preparation after a lost
		// lock connection and records recovery metadata if the process crashes.
		const dirOutput = await execAsyncWithStdin(
			`docker exec -i ${shellQuote(containerId)} sh -c ${sq(buildRedisSnapshotScript(120, token))}`,
			`${linked.databasePassword}\n`,
			{ serverId: linked.serverId },
		);
		const lines = dirOutput.trim().split("\n");
		const dataDir = lines.pop()?.trim() ?? "";
		const previous = lines.pop()?.trim() ?? "";
		const cleanupScript = buildRedisSnapshotCleanupScript(previous, token);
		const label = `Snapshot of redis ${backupRow.appName}`;
		const key = buildBackupKey(backupRow.prefix, backupRow.appName);
		let bytes: number;
		try {
			signal.throwIfAborted();
			if (!isSafeRedisDataDir(dataDir))
				throw new Error(`Unexpected redis data directory reported by ${backupRow.appName}`);
			const proc = await spawnStreamingCommand(
				linked.serverId,
				buildStreamPipeline(`docker cp ${shellQuote(containerId)}:${dataDir} -`),
				{ signal },
			);
			bytes = await storeStreamedArchive(store, key, proc, label);
			signal.throwIfAborted();
		} finally {
			await execAsyncWithStdin(
				`docker exec -i ${shellQuote(containerId)} sh -c ${sq(cleanupScript)}`,
				`${linked.databasePassword}\n`,
				{ serverId: linked.serverId },
			);
		}
		await pruneOldBackups(store, backupPrefix(backupRow), backupRow.keepLatestCount);
		return { key, bytes };
	});
}

/**
 * Restore redis from a stored snapshot: unpack the data-directory tar back
 * into the container, then SHUTDOWN NOSAVE — the Swarm restart policy
 * brings redis back and it loads the restored RDB/AOF from disk.
 */
async function assertStoppedRedis(backupRow: BackupRow, serverId: string | null): Promise<string> {
	const spec = JSON.parse(
		await execAsync(`docker service inspect ${sq(backupRow.appName)} --format '{{json .Spec}}'`),
	);
	const volumeName = `${backupRow.appName}-data`;
	const mounts = spec.TaskTemplate?.ContainerSpec?.Mounts as
		| Array<{ Type?: string; Source?: string; Target?: string }>
		| undefined;
	if (
		spec.Name !== backupRow.appName ||
		!isManagedDatabaseLabels(spec.Labels, "redis") ||
		spec.Mode?.Replicated?.Replicas !== 0 ||
		!mounts?.some((m) => m.Type === "volume" && m.Source === volumeName && m.Target === "/data")
	) {
		throw new Error("Stop the managed Redis service before restoring its /data volume");
	}
	await waitStoppedTasks(backupRow.appName, serverId);
	const volume = JSON.parse(
		await run(serverId, `docker volume inspect ${sq(volumeName)} --format '{{json .}}'`),
	);
	if (volume.Name !== volumeName || volume.Labels?.["nixploy.managed"] !== "true")
		throw new Error("Redis data volume ownership could not be verified");
	await assertStoppedVolume(volumeName, serverId);
	return volumeName;
}

async function restoreRedisBackup(backupRow: BackupRow, key?: string): Promise<{ key: string }> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const targetKey = await resolveStoredKey(backupRow, key);
	const linked = await findLinkedDatabase(backupRow);
	const volumeName = await assertStoppedRedis(backupRow, linked.serverId);
	return await withValidatedArchive(storeFor(destination), targetKey, async (archive) => {
		await preflightTar(archive, linked.serverId, "data");
		// Recheck after validation, then stage a complete replacement so stale
		// AOF files cannot override the selected snapshot on the next start.
		await assertStoppedRedis(backupRow, linked.serverId);
		const script = buildVolumeReplacementScript(
			VOLUME_MOUNT,
			randomBytes(12).toString("hex"),
			"data",
		);
		await replayArchive(
			archive,
			linked.serverId,
			`docker run --rm -i --network none -v ${sq(`${volumeName}:${VOLUME_MOUNT}`)} alpine sh -c ${sq(script)}`,
		);
		return { key: targetKey };
	});
}

// ── volume archives ─────────────────────────────────────────────────────────

/** Resolve the server a volume lives on via the volume backup's service link. */
async function resolveVolumeServerId(volumeBackup: VolumeBackupRow): Promise<string | null> {
	if (volumeBackup.serviceType === "application" && volumeBackup.applicationId) {
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, volumeBackup.applicationId),
		});
		return app?.serverId ?? null;
	}
	if (volumeBackup.serviceType === "compose" && volumeBackup.composeId) {
		const stack = await db.query.compose.findFirst({
			where: eq(compose.composeId, volumeBackup.composeId),
		});
		return stack?.serverId ?? null;
	}
	return null;
}

const VOLUME_MOUNT = "/volume-data";

/**
 * Archive a named Docker volume (tar.gz via a throwaway alpine container)
 * and store it in the row's destination. Recorded as a `backup_run` row.
 */
export async function runVolumeBackup(
	volumeBackup: VolumeBackupRow,
	options: RunOptions = {},
): Promise<RunResult> {
	assertDockerVolumeName(volumeBackup.volumeName);
	if (PROTECTED_VOLUMES.has(volumeBackup.volumeName)) {
		throw new Error(`Refusing to back up platform volume: ${volumeBackup.volumeName}`);
	}
	const destination = await findDestinationOrThrow(volumeBackup.destinationId);
	return await withBackupRun(
		{
			kind: "volume",
			scope: { volumeBackupId: volumeBackup.volumeBackupId },
			organizationId: destination.organizationId,
			destinationId: destination.destinationId,
			trigger: options.trigger ?? "manual",
			secrets: [destination.accessKey, destination.secretAccessKey],
		},
		async () => {
			const store = storeFor(destination);
			const serverId = await resolveVolumeServerId(volumeBackup);

			// `docker run -v <name>:…` silently creates a missing volume, which would
			// upload an empty archive and prune real ones — require it to exist.
			await run(
				serverId,
				`docker volume inspect ${sq(volumeBackup.volumeName)} --format '{{.Name}}'`,
			).catch(() => {
				throw new Error(`Volume ${volumeBackup.volumeName} does not exist on the target server`);
			});

			const archiveCmd =
				`docker run --rm --network none -v ${sq(`${volumeBackup.volumeName}:${VOLUME_MOUNT}:ro`)} alpine ` +
				`sh -c ${sq(`tar cf - -C ${VOLUME_MOUNT} .`)}`;
			const label = `Archive of volume ${volumeBackup.volumeName}`;
			const key = buildBackupKey(volumeBackup.prefix, volumeBackup.volumeName);
			const proc = await spawnStreamingCommand(serverId, buildStreamPipeline(archiveCmd));
			const bytes = await storeStreamedArchive(store, key, proc, label);
			await pruneOldBackups(store, volumePrefix(volumeBackup), volumeBackup.keepLatestCount);
			return { key, bytes };
		},
	);
}

/** Keys of every stored archive of a volume backup, newest first. */
export async function listVolumeBackupKeys(volumeBackup: VolumeBackupRow): Promise<string[]> {
	const destination = await findDestinationOrThrow(volumeBackup.destinationId);
	const keys = await storeFor(destination).list(volumePrefix(volumeBackup));
	return keys.reverse();
}

/** Restore a volume from a stored archive (newest when `key` is omitted). */
export async function restoreVolumeBackup(
	volumeBackup: VolumeBackupRow,
	key?: string,
): Promise<{ key: string }> {
	assertDockerVolumeName(volumeBackup.volumeName);
	if (PROTECTED_VOLUMES.has(volumeBackup.volumeName)) {
		throw new Error(`Refusing to restore into platform volume: ${volumeBackup.volumeName}`);
	}
	const destination = await findDestinationOrThrow(volumeBackup.destinationId);
	const keys = await listVolumeBackupKeys(volumeBackup);
	const targetKey = key ?? keys[0];
	if (!targetKey) {
		throw new Error(`No stored archive found for volume ${volumeBackup.volumeName}`);
	}
	if (!keys.includes(targetKey)) {
		throw new Error(
			`Archive ${targetKey} does not belong to volume backup ${volumeBackup.volumeBackupId}`,
		);
	}

	const serverId = await resolveVolumeServerId(volumeBackup);
	return await withValidatedArchive(storeFor(destination), targetKey, async (archive) => {
		await preflightTar(archive, serverId);
		await assertStoppedVolume(volumeBackup.volumeName, serverId);
		const script = buildVolumeReplacementScript(VOLUME_MOUNT, randomBytes(12).toString("hex"));
		const restoreCmd = `docker run --rm -i --network none -v ${sq(`${volumeBackup.volumeName}:${VOLUME_MOUNT}`)} alpine sh -c ${sq(script)}`;
		await replayArchive(archive, serverId, restoreCmd);
		return { key: targetKey };
	});
}

// ── notifications ───────────────────────────────────────────────────────────

/** Fan out a databaseBackup event to the destination owner's channels. */
export async function emitBackupNotification(
	destination: DestinationRow,
	input: {
		serviceName: string;
		status: "done" | "error";
		errorMessage?: string | null;
	},
): Promise<void> {
	const success = input.status === "done";
	await notifyEvent(destination.organizationId, "databaseBackup", {
		title: success ? "✅ Backup Successful" : "❌ Backup Failed",
		message: success
			? `Backup of ${input.serviceName} finished successfully.`
			: `Backup of ${input.serviceName} failed.${input.errorMessage ? ` ${input.errorMessage}` : ""}`,
		fields: [
			{ name: "Service", value: input.serviceName },
			{ name: "Destination", value: destination.name },
			{ name: "Status", value: input.status },
			...(input.errorMessage ? [{ name: "Error", value: input.errorMessage }] : []),
			{ name: "Date", value: new Date().toISOString() },
		],
	});
}
