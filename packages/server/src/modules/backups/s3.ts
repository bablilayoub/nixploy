import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	PutObjectCommand,
	UploadPartCommand,
} from "@aws-sdk/client-s3";

/**
 * Streaming multipart upload, written against `@aws-sdk/client-s3` directly.
 *
 * `@aws-sdk/lib-storage` (the usual `Upload` helper) is deliberately NOT a
 * dependency — the workspace dependency set is fixed — and the whole point of
 * architecture audit #18 is to stop materialising a dump in memory, so this
 * accumulates exactly one 8 MiB part at a time:
 *
 * - under one part, a plain `PutObject` (no multipart bookkeeping, and it
 *   works on S3-compatible servers with partial multipart support);
 * - otherwise `CreateMultipartUpload` → N × `UploadPart` →
 *   `CompleteMultipartUpload`, with `AbortMultipartUpload` on ANY failure so a
 *   failed dump never leaves billable orphan parts behind.
 */

/** S3's minimum part size is 5 MiB; 8 leaves headroom without much memory. */
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

/** The subset of `S3Client` this module uses — keeps the fake in tests small. */
export interface S3Sender {
	send(command: unknown): Promise<unknown>;
}

export interface MultipartOptions {
	partSizeBytes?: number;
}

interface CompletedPart {
	ETag: string;
	PartNumber: number;
}

/**
 * Upload `source` to `bucket/key`. Returns the number of bytes stored.
 * An error thrown by the source (a failed dump, a bad gzip) aborts the
 * upload and propagates, so nothing partial is ever completed.
 */
export async function uploadStream(
	client: S3Sender,
	bucket: string,
	key: string,
	source: AsyncIterable<Buffer>,
	options: MultipartOptions = {},
): Promise<number> {
	const partSize = Math.max(5 * 1024 * 1024, options.partSizeBytes ?? DEFAULT_PART_SIZE);
	let uploadId: string | null = null;
	const parts: CompletedPart[] = [];
	let pending: Buffer = Buffer.alloc(0);
	let total = 0;

	const uploadPart = async (body: Buffer): Promise<void> => {
		if (!uploadId) {
			const created = (await client.send(
				new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
			)) as { UploadId?: string };
			if (!created.UploadId) throw new Error(`S3 did not return an upload id for ${key}`);
			uploadId = created.UploadId;
		}
		const partNumber = parts.length + 1;
		const uploaded = (await client.send(
			new UploadPartCommand({
				Bucket: bucket,
				Key: key,
				UploadId: uploadId,
				PartNumber: partNumber,
				Body: body,
			}),
		)) as { ETag?: string };
		if (!uploaded.ETag) throw new Error(`S3 did not return an ETag for part ${partNumber}`);
		parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
	};

	try {
		for await (const chunk of source) {
			if (chunk.length === 0) continue;
			total += chunk.length;
			pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
			while (pending.length >= partSize) {
				const head = pending.subarray(0, partSize);
				pending = pending.subarray(partSize);
				await uploadPart(head);
			}
		}

		if (!uploadId) {
			// Small enough for a single request — no multipart bookkeeping.
			await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: pending }));
			return total;
		}
		if (pending.length > 0) await uploadPart(pending);
		await client.send(
			new CompleteMultipartUploadCommand({
				Bucket: bucket,
				Key: key,
				UploadId: uploadId,
				MultipartUpload: { Parts: parts },
			}),
		);
		return total;
	} catch (error) {
		if (uploadId) {
			await client
				.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
				.catch(() => {
					// Best effort: the bucket's lifecycle rule is the backstop.
				});
		}
		throw error;
	}
}
