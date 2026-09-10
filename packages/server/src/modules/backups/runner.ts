import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
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
import { execAsync, execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { assertDockerVolumeName } from "../../utils/validators";
import { shellQuote } from "../compose/paths";
import { PROTECTED_VOLUMES } from "../docker/protected";
import { notifyEvent } from "../notifications";
import { getConfigDir } from "../traefik/paths";
import { DB_DUMP_CONFIG, type DumpCommandParams } from "./dump-commands";
import {
	buildConfigArchiveCommand,
	buildInstanceContainerDumpCommand,
	buildInstanceContainerFilters,
	buildInstancePgDumpCommand,
	buildRedisSnapshotScript,
	isSafeRedisDataDir,
	parseInstanceDatabaseUrl,
	WEB_SERVER_CONFIG_SUFFIX,
} from "./instance-backup";
import { assertNonEmptyGzip, buildEncodedPipeline, decodePipelineOutput } from "./pipeline";

/**
 * Backup runner: database dumps and volume archives to S3-compatible
 * destinations.
 *
 * Transport strategy (works identically for the local Docker daemon and for
 * remote managed servers over SSH): the dump/archive command runs inside a
 * container on the target server, its bytes are gzipped + base64-encoded in
 * the same shell pipeline (see pipeline.ts — the producer's exit status is
 * carried along so a failed dump never uploads an empty archive), the (text)
 * result travels back through execAsync/execAsyncRemote, and the decoded
 * buffer is uploaded to S3. Restore runs the exact reverse pipeline with the
 * base64 archive fed through stdin — never inlined on argv, which Linux caps
 * at 128 KiB per argument (E2BIG).
 */

export type DestinationRow = typeof destinations.$inferSelect;
export type BackupRow = typeof backups.$inferSelect;
export type VolumeBackupRow = typeof volumeBackups.$inferSelect;

const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const run = (serverId: string | null | undefined, command: string) =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

// ── S3 ──────────────────────────────────────────────────────────────────────

export function getS3Client(destination: DestinationRow): S3Client {
	return new S3Client({
		region: destination.region,
		endpoint: destination.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: destination.accessKey,
			secretAccessKey: destination.secretAccessKey,
		},
	});
}

/** Verify a destination by listing one object in its bucket. */
export async function testDestination(destination: DestinationRow): Promise<{ success: true }> {
	const client = getS3Client(destination);
	await client.send(new ListObjectsV2Command({ Bucket: destination.bucket, MaxKeys: 1 }));
	return { success: true };
}

async function uploadToDestination(
	destination: DestinationRow,
	key: string,
	body: Buffer,
): Promise<void> {
	await getS3Client(destination).send(
		new PutObjectCommand({ Bucket: destination.bucket, Key: key, Body: body }),
	);
}

async function downloadFromDestination(destination: DestinationRow, key: string): Promise<Buffer> {
	const response = await getS3Client(destination).send(
		new GetObjectCommand({ Bucket: destination.bucket, Key: key }),
	);
	const bytes = await response.Body?.transformToByteArray();
	if (!bytes) {
		throw new Error(`Empty response when fetching s3://${destination.bucket}/${key}`);
	}
	return Buffer.from(bytes);
}

/** Object keys under a prefix, oldest first. */
async function listKeys(destination: DestinationRow, prefix: string): Promise<string[]> {
	const client = getS3Client(destination);
	const keys: Array<{ key: string; lastModified: Date }> = [];
	let continuationToken: string | undefined;
	do {
		const response = await client.send(
			new ListObjectsV2Command({
				Bucket: destination.bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const object of response.Contents ?? []) {
			if (object.Key) {
				keys.push({ key: object.Key, lastModified: object.LastModified ?? new Date(0) });
			}
		}
		continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
	} while (continuationToken);
	return keys.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime()).map((k) => k.key);
}

/** Delete every object under `<prefix>/<appName>/` beyond the newest `keepLatestCount`. */
async function pruneOldBackups(
	destination: DestinationRow,
	prefix: string,
	keepLatestCount: number | null,
): Promise<void> {
	if (!keepLatestCount || keepLatestCount <= 0) return;
	const keys = await listKeys(destination, prefix);
	const excess = keys.slice(0, Math.max(0, keys.length - keepLatestCount));
	if (excess.length === 0) return;
	await getS3Client(destination).send(
		new DeleteObjectsCommand({
			Bucket: destination.bucket,
			Delete: { Objects: excess.map((Key) => ({ Key })), Quiet: true },
		}),
	);
}

/** `<prefix>/<appName>/<ISO-timestamp>.gz` (contract layout). */
export function buildBackupKey(prefix: string, appName: string, date = new Date()): string {
	const timestamp = date.toISOString().replace(/[:.]/g, "-");
	return `${prefix}/${appName}/${timestamp}.gz`;
}

// ── database dumps ──────────────────────────────────────────────────────────

type LinkedDatabaseRow = {
	serverId: string | null;
	databaseUser: string;
	databasePassword: string;
	databaseRootPassword?: string | null;
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
				return { serverId: row.serverId, databaseUser: "", databasePassword: row.databasePassword };
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
		if (containerId) return containerId;
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

/**
 * Run a database dump and upload it to the row's destination.
 * Returns the S3 key of the uploaded archive.
 */
export async function runBackup(backupRow: BackupRow): Promise<{ key: string }> {
	const databaseType = backupRow.databaseType;
	if (databaseType === "web-server") {
		return await runWebServerBackup(backupRow);
	}
	if (databaseType === "redis") {
		return await runRedisBackup(backupRow);
	}
	const engine = DB_DUMP_CONFIG[databaseType];
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, backupRow.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${backupRow.destinationId}`);
	}
	const linked = await findLinkedDatabase(backupRow);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);

	const params = dumpParams(backupRow, linked);
	const dumpCommand = engine.dumpCommand(params);
	if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
		throw new Error(`Unexpected container id for ${backupRow.appName}`);
	}
	const passwordEnv = engine.passwordEnv?.(params) ?? {};
	const passwordEntries = Object.entries(passwordEnv);
	let encoded: string;
	if (passwordEntries.length > 0) {
		// Password on stdin (first line) — never on docker/ps argv.
		const exports = passwordEntries.map(([key]) => key).join(" ");
		const reader = passwordEntries.map(([key]) => `IFS= read -r ${key}`).join("; ");
		const inner = `${reader}; export ${exports}; ${dumpCommand}`;
		const pipeline = buildEncodedPipeline(
			`docker exec -i ${shellQuote(containerId)} sh -c ${sq(inner)}`,
		);
		encoded = await execAsyncWithStdin(
			pipeline,
			`${passwordEntries.map(([, v]) => v).join("\n")}\n`,
			{
				serverId: linked.serverId,
			},
		);
	} else {
		const pipeline = buildEncodedPipeline(
			`docker exec ${shellQuote(containerId)} sh -c ${sq(dumpCommand)}`,
		);
		encoded = await run(linked.serverId, pipeline);
	}
	const label = `Dump of ${backupRow.appName}`;
	const archive = decodePipelineOutput(encoded, label);
	assertNonEmptyGzip(archive, label);

	const key = buildBackupKey(backupRow.prefix, backupRow.appName);
	await uploadToDestination(destination, key, archive);
	await pruneOldBackups(
		destination,
		`${backupRow.prefix}/${backupRow.appName}/`,
		backupRow.keepLatestCount,
	);
	return { key };
}

/** Keys of every stored dump of a backup row, newest first. */
export async function listBackupKeys(backupRow: BackupRow): Promise<string[]> {
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, backupRow.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${backupRow.destinationId}`);
	}
	const keys = await listKeys(destination, `${backupRow.prefix}/${backupRow.appName}/`);
	return keys.reverse();
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
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, backupRow.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${backupRow.destinationId}`);
	}
	const keys = await listBackupKeys(backupRow);
	const targetKey = key ?? keys[0];
	if (!targetKey) {
		throw new Error(`No stored dump found for ${backupRow.appName}`);
	}
	if (!keys.includes(targetKey)) {
		throw new Error(`Dump ${targetKey} does not belong to backup ${backupRow.backupId}`);
	}

	const archive = await downloadFromDestination(destination, targetKey);
	const linked = await findLinkedDatabase(backupRow);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);

	const params = dumpParams(backupRow, linked);
	const restoreCommand = engine.restoreCommand(params);
	if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
		throw new Error(`Unexpected container id for ${backupRow.appName}`);
	}
	const passwordEnv = engine.passwordEnv?.(params) ?? {};
	const passwordEntries = Object.entries(passwordEnv);
	const archiveB64 = archive.toString("base64");
	if (passwordEntries.length > 0) {
		const passFile = "/tmp/.nixploy-db-pass";
		await execAsyncWithStdin(
			`docker exec -i ${shellQuote(containerId)} tee ${passFile} >/dev/null`,
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
			await execAsyncWithStdin(
				`base64 -d | gunzip | docker exec -i ${shellQuote(containerId)} sh -c ${sq(wrapped)}`,
				archiveB64,
				{ serverId: linked.serverId },
			);
		} finally {
			await run(linked.serverId, `docker exec ${shellQuote(containerId)} rm -f ${passFile}`);
		}
	} else {
		// The archive travels through stdin: inlining it on argv fails with
		// E2BIG once the base64 exceeds ~128 KiB (i.e. every real database).
		await execAsyncWithStdin(
			`base64 -d | gunzip | docker exec -i ${shellQuote(containerId)} sh -c ${sq(restoreCommand)}`,
			archiveB64,
			{ serverId: linked.serverId },
		);
	}
	return { key: targetKey };
}

// ── instance self-backup (web-server) ───────────────────────────────────────

async function findDestinationOrThrow(destinationId: string): Promise<DestinationRow> {
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${destinationId}`);
	}
	return destination;
}

/**
 * Dump the instance database by shelling out to a Postgres container when
 * the Nixploy process itself has no pg_dump. The DATABASE_URL host is the
 * Swarm service name in production and the compose service name in
 * docker-compose.dev.yml, so the container is found by that name.
 */
async function dumpInstanceFromContainer(
	target: ReturnType<typeof parseInstanceDatabaseUrl>,
): Promise<string> {
	for (const filter of buildInstanceContainerFilters(target.host)) {
		const output = await execAsync(`docker ps -q ${filter} | head -n 1`);
		const containerId = output.trim().split("\n")[0]?.trim();
		if (containerId && /^[a-f0-9]{12,64}$/i.test(containerId)) {
			return await execAsync(
				buildEncodedPipeline(
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
 * certificates, SSH keys). Uploaded as two sibling artifacts —
 * `<prefix>/<appName>/<ts>.gz` and `<prefix>/<appName>-config/<ts>.gz` —
 * so retention prunes each stream independently. Restore is manual
 * (docs/instance-backup.md).
 */
async function runWebServerBackup(backupRow: BackupRow): Promise<{ key: string }> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const target = parseInstanceDatabaseUrl(process.env.DATABASE_URL);

	// Prefer a local pg_dump (password via PGPASSWORD env, never argv);
	// fall back to the instance's own Postgres container when the app
	// image (or the dev host) has no Postgres client installed.
	const hasLocalPgDump = await execAsync("command -v pg_dump")
		.then(() => true)
		.catch(() => false);
	const encodedDump = hasLocalPgDump
		? await execAsync(buildEncodedPipeline(buildInstancePgDumpCommand(target)), {
				env: { ...process.env, PGPASSWORD: target.password },
			})
		: await dumpInstanceFromContainer(target);
	const dump = decodePipelineOutput(encodedDump, "Dump of the instance database");
	assertNonEmptyGzip(dump, "Dump of the instance database");

	// tar czf already compresses; only base64 for transport.
	const encodedConfig = await execAsync(
		buildEncodedPipeline(buildConfigArchiveCommand(getConfigDir()), "base64"),
	);
	const configArchive = decodePipelineOutput(
		encodedConfig,
		"Archive of the instance config directory",
	);
	assertNonEmptyGzip(configArchive, "Archive of the instance config directory");

	const date = new Date();
	const dumpKey = buildBackupKey(backupRow.prefix, backupRow.appName, date);
	const configKey = buildBackupKey(
		backupRow.prefix,
		`${backupRow.appName}${WEB_SERVER_CONFIG_SUFFIX}`,
		date,
	);
	await uploadToDestination(destination, dumpKey, dump);
	await uploadToDestination(destination, configKey, configArchive);
	await pruneOldBackups(
		destination,
		`${backupRow.prefix}/${backupRow.appName}/`,
		backupRow.keepLatestCount,
	);
	await pruneOldBackups(
		destination,
		`${backupRow.prefix}/${backupRow.appName}${WEB_SERVER_CONFIG_SUFFIX}/`,
		backupRow.keepLatestCount,
	);
	return { key: dumpKey };
}

// ── redis ────────────────────────────────────────────────────────────────────

/**
 * Snapshot a redis service: BGSAVE (or blocking SAVE) inside the container,
 * wait for persistence to finish, then `docker cp` the whole data directory
 * (dump.rdb plus the AOF when appendonly is enabled) into a tar.gz on S3.
 */
async function runRedisBackup(backupRow: BackupRow): Promise<{ key: string }> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const linked = await findLinkedDatabase(backupRow);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);
	if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
		throw new Error(`Unexpected container id for ${backupRow.appName}`);
	}

	// Password on stdin (first line) — never on docker/ps argv.
	const dirOutput = await execAsyncWithStdin(
		`docker exec -i ${shellQuote(containerId)} sh -c ${sq(buildRedisSnapshotScript())}`,
		`${linked.databasePassword}\n`,
		{ serverId: linked.serverId },
	);
	const dataDir = dirOutput.trim().split("\n").pop()?.trim() ?? "";
	if (!isSafeRedisDataDir(dataDir)) {
		throw new Error(`Unexpected redis data directory reported by ${backupRow.appName}`);
	}

	// `docker cp <id>:<dir> -` streams a tar of the data directory.
	const encoded = await run(
		linked.serverId,
		buildEncodedPipeline(`docker cp ${shellQuote(containerId)}:${dataDir} -`),
	);
	const label = `Snapshot of redis ${backupRow.appName}`;
	const archive = decodePipelineOutput(encoded, label);
	assertNonEmptyGzip(archive, label);

	const key = buildBackupKey(backupRow.prefix, backupRow.appName);
	await uploadToDestination(destination, key, archive);
	await pruneOldBackups(
		destination,
		`${backupRow.prefix}/${backupRow.appName}/`,
		backupRow.keepLatestCount,
	);
	return { key };
}

/**
 * Restore redis from a stored snapshot: unpack the data-directory tar back
 * into the container, then SHUTDOWN NOSAVE — the Swarm restart policy
 * brings redis back and it loads the restored RDB/AOF from disk.
 */
async function restoreRedisBackup(backupRow: BackupRow, key?: string): Promise<{ key: string }> {
	const destination = await findDestinationOrThrow(backupRow.destinationId);
	const keys = await listBackupKeys(backupRow);
	const targetKey = key ?? keys[0];
	if (!targetKey) {
		throw new Error(`No stored dump found for ${backupRow.appName}`);
	}
	if (!keys.includes(targetKey)) {
		throw new Error(`Dump ${targetKey} does not belong to backup ${backupRow.backupId}`);
	}

	const archive = await downloadFromDestination(destination, targetKey);
	const linked = await findLinkedDatabase(backupRow);
	const containerId = await findContainerId(backupRow.appName, linked.serverId);
	if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
		throw new Error(`Unexpected container id for ${backupRow.appName}`);
	}

	// The tar holds the data dir at its original absolute path (e.g. `data/`),
	// so extracting into the container root puts dump.rdb/AOF back in place.
	await execAsyncWithStdin(
		`base64 -d | gunzip | docker cp - ${shellQuote(containerId)}:/`,
		archive.toString("base64"),
		{ serverId: linked.serverId },
	);
	// SHUTDOWN drops the connection — a non-zero exit is expected here.
	await execAsyncWithStdin(
		`docker exec -i ${shellQuote(containerId)} sh -c ${sq(
			"IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; redis-cli --no-auth-warning SHUTDOWN NOSAVE",
		)}`,
		`${linked.databasePassword}\n`,
		{ serverId: linked.serverId },
	).catch(() => {});
	return { key: targetKey };
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
 * and upload it to the row's destination.
 */
export async function runVolumeBackup(volumeBackup: VolumeBackupRow): Promise<{ key: string }> {
	assertDockerVolumeName(volumeBackup.volumeName);
	if (PROTECTED_VOLUMES.has(volumeBackup.volumeName)) {
		throw new Error(`Refusing to back up platform volume: ${volumeBackup.volumeName}`);
	}
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, volumeBackup.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${volumeBackup.destinationId}`);
	}
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
		`docker run --rm -v ${sq(`${volumeBackup.volumeName}:${VOLUME_MOUNT}`)} alpine ` +
		`sh -c ${sq(`tar czf - -C ${VOLUME_MOUNT} .`)}`;
	const encoded = await run(serverId, buildEncodedPipeline(archiveCmd, "base64"));
	const label = `Archive of volume ${volumeBackup.volumeName}`;
	const archive = decodePipelineOutput(encoded, label);
	assertNonEmptyGzip(archive, label);

	const key = buildBackupKey(volumeBackup.prefix, volumeBackup.volumeName);
	await uploadToDestination(destination, key, archive);
	await pruneOldBackups(
		destination,
		`${volumeBackup.prefix}/${volumeBackup.volumeName}/`,
		volumeBackup.keepLatestCount,
	);
	return { key };
}

/** Keys of every stored archive of a volume backup, newest first. */
export async function listVolumeBackupKeys(volumeBackup: VolumeBackupRow): Promise<string[]> {
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, volumeBackup.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${volumeBackup.destinationId}`);
	}
	const keys = await listKeys(destination, `${volumeBackup.prefix}/${volumeBackup.volumeName}/`);
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
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, volumeBackup.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${volumeBackup.destinationId}`);
	}
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

	const archive = await downloadFromDestination(destination, targetKey);
	const serverId = await resolveVolumeServerId(volumeBackup);
	const restoreCmd =
		`docker run --rm -i -v ${sq(`${volumeBackup.volumeName}:${VOLUME_MOUNT}`)} alpine ` +
		`sh -c ${sq(`cd ${VOLUME_MOUNT} && tar xzf -`)}`;
	await execAsyncWithStdin(`base64 -d | ${restoreCmd}`, archive.toString("base64"), { serverId });
	return { key: targetKey };
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
