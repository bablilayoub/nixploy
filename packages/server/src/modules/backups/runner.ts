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
	type volumeBackups,
} from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { notifyEvent } from "../notifications";
import { DB_DUMP_CONFIG, type DumpCommandParams } from "./dump-commands";

/**
 * Backup runner: database dumps and volume archives to S3-compatible
 * destinations.
 *
 * Transport strategy (works identically for the local Docker daemon and for
 * remote managed servers over SSH): the dump/archive command runs inside a
 * container on the target server, its bytes are gzipped + base64-encoded in
 * the same shell pipeline, the (text) result travels back through
 * execAsync/execAsyncRemote, and the decoded buffer is uploaded to S3.
 * Restore runs the exact reverse pipeline.
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
	}
	throw new Error(
		`Backup ${backupRow.backupId}: no linked ${backupRow.databaseType} database found`,
	);
}

async function findContainerId(appName: string, serverId: string | null): Promise<string> {
	const output = await run(serverId, `docker ps -q --filter "name=${appName}" | head -n 1`);
	const containerId = output.trim().split("\n")[0]?.trim();
	if (!containerId) {
		throw new Error(`No running container found for ${appName}`);
	}
	return containerId;
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
		throw new Error("web-server backups are not supported");
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

	const dumpCommand = engine.dumpCommand(dumpParams(backupRow, linked));
	const pipeline = `docker exec ${containerId} sh -c ${sq(dumpCommand)} | gzip | base64`;
	const encoded = await run(linked.serverId, pipeline);
	const archive = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
	if (archive.length === 0) {
		throw new Error(`Dump of ${backupRow.appName} produced no data`);
	}

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
		throw new Error("web-server backups are not supported");
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

	const restoreCommand = engine.restoreCommand(dumpParams(backupRow, linked));
	// base64 contains no shell-special characters, so it can be inlined safely.
	const pipeline = `echo ${archive.toString("base64")} | base64 -d | gunzip | docker exec -i ${containerId} sh -c ${sq(restoreCommand)}`;
	await run(linked.serverId, pipeline);
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
	const destination = await db.query.destinations.findFirst({
		where: eq(destinations.destinationId, volumeBackup.destinationId),
	});
	if (!destination) {
		throw new Error(`Destination not found: ${volumeBackup.destinationId}`);
	}
	const serverId = await resolveVolumeServerId(volumeBackup);

	const archiveCmd =
		`docker run --rm -v ${sq(`${volumeBackup.volumeName}:${VOLUME_MOUNT}`)} alpine ` +
		`sh -c ${sq(`tar czf - -C ${VOLUME_MOUNT} .`)}`;
	const encoded = await run(serverId, `${archiveCmd} | base64`);
	const archive = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
	if (archive.length === 0) {
		throw new Error(`Archive of volume ${volumeBackup.volumeName} produced no data`);
	}

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
	await run(serverId, `echo ${archive.toString("base64")} | base64 -d | ${restoreCmd}`);
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
