import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { getConfigDir } from "../traefik/paths";
import type { BackupStore } from "./storage";

export interface ValidatedArchive {
	bytes: number;
	/** Every replay reads the same validated bytes, even if the object changes. */
	open(): ReturnType<typeof createReadStream>;
}

/**
 * Download once and check the entire gzip (including CRC/truncation) before
 * handing any bytes to a restore command. Disk usage is the compressed size;
 * memory is bounded by stream buffers. cache/ is excluded from self-backups.
 */
export async function withValidatedArchive<T>(
	store: BackupStore,
	key: string,
	work: (archive: ValidatedArchive) => Promise<T>,
): Promise<T> {
	const root = path.join(getConfigDir(), "cache", "backup-restores");
	await mkdir(root, { recursive: true, mode: 0o700 });
	const dir = await mkdtemp(path.join(root, "restore-"));
	const file = path.join(dir, "archive.gz");
	try {
		await pipeline(
			await store.getStream(key),
			createWriteStream(file, { flags: "wx", mode: 0o600 }),
		);
		let uncompressedBytes = 0;
		await pipeline(
			createReadStream(file),
			createGunzip(),
			new Writable({
				write(chunk: Buffer, _encoding, callback) {
					uncompressedBytes += chunk.length;
					callback();
				},
			}),
		);
		if (uncompressedBytes === 0) throw new Error(`Archive ${key} is empty`);
		return await work({ bytes: (await stat(file)).size, open: () => createReadStream(file) });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
