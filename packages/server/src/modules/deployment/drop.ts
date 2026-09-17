import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { badRequest, payloadTooLarge } from "../errors";
import { getDropZipPath } from "./paths";

/**
 * Receiving the archive a `drop` application deploys.
 *
 * The worker half has always been here (`extractDropSource` unpacks
 * `<config>/applications/<appName>/code.zip` with Zip-Slip checks); this is
 * the half that puts the file there. Until it existed the source type was
 * unusable from every surface, and the panel told operators to run a CLI flag
 * that did not exist.
 */

/** Hard ceiling on an uploaded archive. Bigger sources belong in a registry. */
export const MAX_DROP_ARCHIVE_BYTES = 256 * 1024 * 1024;

/** Local ZIP header, including the empty-archive and spanned variants. */
const ZIP_MAGICS = [
	Buffer.from([0x50, 0x4b, 0x03, 0x04]),
	Buffer.from([0x50, 0x4b, 0x05, 0x06]),
	Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

/**
 * Reject anything that is not a zip before it is stored.
 *
 * The extractor would fail on it anyway, but that failure arrives as a broken
 * deployment minutes later; this one arrives as a 400 while the operator is
 * still looking at the upload.
 */
export function assertZipArchive(head: Buffer): void {
	if (!ZIP_MAGICS.some((magic) => head.subarray(0, magic.length).equals(magic))) {
		throw badRequest("That file is not a zip archive");
	}
}

/**
 * Store an uploaded archive for `appName`, replacing any previous one.
 *
 * Written to a temporary file in the same directory and renamed into place, so
 * a deploy racing the upload either sees the whole old archive or the whole
 * new one, never a half-written file. Mode 0600: the archive is tenant source
 * code and the config dir is shared with other services.
 */
export async function storeDropArchive(appName: string, archive: Buffer): Promise<number> {
	if (archive.byteLength === 0) throw badRequest("The uploaded archive is empty");
	if (archive.byteLength > MAX_DROP_ARCHIVE_BYTES) {
		throw payloadTooLarge(
			`Archive is larger than ${Math.floor(MAX_DROP_ARCHIVE_BYTES / (1024 * 1024))} MB`,
		);
	}
	assertZipArchive(archive);

	const target = getDropZipPath(appName);
	const temporary = `${target}.upload`;
	await mkdir(path.dirname(target), { recursive: true });
	try {
		await writeFile(temporary, archive, { mode: 0o600 });
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
	return archive.byteLength;
}
