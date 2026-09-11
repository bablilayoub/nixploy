import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { destinations } from "../../db/schema";
import { getConfigDir } from "../traefik/paths";

/**
 * Where backup archives live. Two providers share one key space
 * (`<prefix>/<appName>/<ISO-timestamp>.gz`):
 *
 * - `s3` (default): an S3-compatible bucket addressed by the destination row.
 * - `local`: the panel host's disk under `<config>/backups/<organizationId>/<key>`.
 *   Remote-server dumps still travel back through the panel process, so
 *   "local" always means the Nixploy host (its config volume), never the
 *   server the database runs on.
 *
 * The runner only talks to {@link BackupStore}; provider branches stay here.
 */

export type DestinationRow = typeof destinations.$inferSelect;

export const LOCAL_PROVIDER = "local";

export interface BackupStore {
	put(key: string, body: Buffer): Promise<void>;
	get(key: string): Promise<Buffer>;
	/** Keys under `prefix`, oldest first (retention deletes from the front). */
	list(prefix: string): Promise<string[]>;
	remove(keys: string[]): Promise<void>;
	/** Cheap reachability/writability probe for the destination "test" button. */
	test(): Promise<void>;
	/** Human-readable location of a key, for error messages. */
	describe(key: string): string;
}

export function isLocalDestination(destination: Pick<DestinationRow, "provider">): boolean {
	return destination.provider === LOCAL_PROVIDER;
}

/** `<config>/backups` — root of every local destination. */
export function getLocalBackupsDir(): string {
	return path.join(getConfigDir(), "backups");
}

/** `<config>/backups/<organizationId>` — one subtree per tenant. */
export function localDestinationRoot(destination: Pick<DestinationRow, "organizationId">): string {
	return path.join(getLocalBackupsDir(), destination.organizationId);
}

/**
 * Keys are `/`-separated relative paths built by the runner from a prefix,
 * an app name and a timestamp. Anything else (absolute paths, `..`, empty
 * or dot segments, backslashes, NUL) is refused before it can reach the
 * filesystem — restore/verify keys come from API input.
 */
export function isSafeLocalKey(key: string): boolean {
	if (!key || key.length > 1024 || key.includes("\0") || key.includes("\\")) return false;
	if (key.startsWith("/") || key.endsWith("/")) return false;
	return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Absolute file path of `key` under `root`, guaranteed to stay inside it. */
export function resolveLocalKeyPath(root: string, key: string): string {
	if (!isSafeLocalKey(key)) {
		throw new Error(`Invalid backup key: ${key}`);
	}
	const resolvedRoot = path.resolve(root);
	const file = path.resolve(resolvedRoot, ...key.split("/"));
	if (!file.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Invalid backup key: ${key}`);
	}
	return file;
}

// ── local disk ──────────────────────────────────────────────────────────────

export class LocalBackupStore implements BackupStore {
	constructor(readonly root: string) {}

	private fileOf(key: string): string {
		return resolveLocalKeyPath(this.root, key);
	}

	async put(key: string, body: Buffer): Promise<void> {
		const file = this.fileOf(key);
		await mkdir(path.dirname(file), { recursive: true });
		// Write-then-rename so a crash mid-write never leaves a truncated
		// archive that retention would count as a valid backup.
		const tmp = `${file}.part`;
		await writeFile(tmp, body, { mode: 0o600 });
		await rename(tmp, file);
	}

	async get(key: string): Promise<Buffer> {
		return await readFile(this.fileOf(key));
	}

	async list(prefix: string): Promise<string[]> {
		const entries: Array<{ key: string; mtime: number }> = [];
		const walk = async (dir: string, rel: string): Promise<void> => {
			let names: string[];
			try {
				names = await readdir(dir);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
				throw error;
			}
			for (const name of names) {
				const full = path.join(dir, name);
				const key = rel ? `${rel}/${name}` : name;
				const info = await stat(full);
				if (info.isDirectory()) {
					await walk(full, key);
				} else if (info.isFile() && !name.endsWith(".part") && key.startsWith(prefix)) {
					entries.push({ key, mtime: info.mtimeMs });
				}
			}
		};
		await walk(this.root, "");
		return entries.sort((a, b) => a.mtime - b.mtime).map((entry) => entry.key);
	}

	async remove(keys: string[]): Promise<void> {
		for (const key of keys) {
			try {
				await unlink(this.fileOf(key));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}

	async test(): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const probe = path.join(this.root, `.write-test-${process.pid}`);
		await writeFile(probe, "ok", { mode: 0o600 });
		await unlink(probe);
	}

	describe(key: string): string {
		return path.join(this.root, ...key.split("/"));
	}
}

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

export class S3BackupStore implements BackupStore {
	private readonly client: S3Client;

	constructor(private readonly destination: DestinationRow) {
		this.client = getS3Client(destination);
	}

	async put(key: string, body: Buffer): Promise<void> {
		await this.client.send(
			new PutObjectCommand({ Bucket: this.destination.bucket, Key: key, Body: body }),
		);
	}

	async get(key: string): Promise<Buffer> {
		const response = await this.client.send(
			new GetObjectCommand({ Bucket: this.destination.bucket, Key: key }),
		);
		const bytes = await response.Body?.transformToByteArray();
		if (!bytes) {
			throw new Error(`Empty response when fetching ${this.describe(key)}`);
		}
		return Buffer.from(bytes);
	}

	async list(prefix: string): Promise<string[]> {
		const keys: Array<{ key: string; lastModified: Date }> = [];
		let continuationToken: string | undefined;
		do {
			const response = await this.client.send(
				new ListObjectsV2Command({
					Bucket: this.destination.bucket,
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
		return keys
			.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())
			.map((entry) => entry.key);
	}

	async remove(keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		await this.client.send(
			new DeleteObjectsCommand({
				Bucket: this.destination.bucket,
				Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
			}),
		);
	}

	async test(): Promise<void> {
		await this.client.send(
			new ListObjectsV2Command({ Bucket: this.destination.bucket, MaxKeys: 1 }),
		);
	}

	describe(key: string): string {
		return `s3://${this.destination.bucket}/${key}`;
	}
}

/** The store behind a destination row (provider dispatch lives here only). */
export function storeFor(destination: DestinationRow): BackupStore {
	if (isLocalDestination(destination)) {
		return new LocalBackupStore(localDestinationRoot(destination));
	}
	return new S3BackupStore(destination);
}
