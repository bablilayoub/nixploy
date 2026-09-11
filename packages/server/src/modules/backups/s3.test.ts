import { describe, expect, it } from "vitest";
import { type S3Sender, uploadStream } from "./s3";

/**
 * Multipart upload against a fake S3. No network, no `@aws-sdk/lib-storage`
 * (not a dependency) — this is the whole contract of architecture audit #18:
 * parts of a fixed size, a single PutObject below that size, and an abort on
 * any failure so a broken dump never completes an upload.
 */

interface FakeCall {
	name: string;
	input: Record<string, unknown>;
}

function fakeS3(options: { failOnPart?: number } = {}) {
	const calls: FakeCall[] = [];
	const parts: Buffer[] = [];
	const client: S3Sender = {
		async send(command: unknown) {
			const name = (command as { constructor: { name: string } }).constructor.name;
			const input = (command as { input: Record<string, unknown> }).input;
			calls.push({ name, input });
			if (name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
			if (name === "UploadPartCommand") {
				const partNumber = input.PartNumber as number;
				if (options.failOnPart === partNumber) throw new Error("part upload failed");
				parts.push(input.Body as Buffer);
				return { ETag: `"etag-${partNumber}"` };
			}
			if (name === "PutObjectCommand") {
				parts.push(input.Body as Buffer);
				return {};
			}
			return {};
		},
	};
	const names = () => calls.map((call) => call.name);
	return { client, calls, parts, names };
}

async function* chunks(total: number, size: number): AsyncGenerator<Buffer> {
	let written = 0;
	let seed = 0;
	while (written < total) {
		const length = Math.min(size, total - written);
		const chunk = Buffer.alloc(length);
		for (let i = 0; i < length; i += 1) chunk[i] = (seed++ + i) % 251;
		written += length;
		yield chunk;
	}
}

const PART = 5 * 1024 * 1024;

describe("uploadStream", () => {
	it("uses a single PutObject below one part", async () => {
		const s3 = fakeS3();
		const bytes = await uploadStream(s3.client, "bucket", "k", chunks(1024, 128), {
			partSizeBytes: PART,
		});

		expect(bytes).toBe(1024);
		expect(s3.names()).toEqual(["PutObjectCommand"]);
		expect(s3.parts[0]?.length).toBe(1024);
	});

	it("splits a large stream into fixed-size parts and completes the upload", async () => {
		const s3 = fakeS3();
		const total = PART * 2 + 1234;
		const bytes = await uploadStream(s3.client, "bucket", "k", chunks(total, 64 * 1024), {
			partSizeBytes: PART,
		});

		expect(bytes).toBe(total);
		expect(s3.names()).toEqual([
			"CreateMultipartUploadCommand",
			"UploadPartCommand",
			"UploadPartCommand",
			"UploadPartCommand",
			"CompleteMultipartUploadCommand",
		]);
		// Every part but the last is exactly the part size (S3's 5 MiB floor).
		expect(s3.parts.map((part) => part.length)).toEqual([PART, PART, 1234]);

		const complete = s3.calls.at(-1)?.input as {
			MultipartUpload: { Parts: Array<{ PartNumber: number; ETag: string }> };
		};
		expect(complete.MultipartUpload.Parts).toEqual([
			{ PartNumber: 1, ETag: '"etag-1"' },
			{ PartNumber: 2, ETag: '"etag-2"' },
			{ PartNumber: 3, ETag: '"etag-3"' },
		]);
	});

	it("preserves the bytes it was given", async () => {
		const s3 = fakeS3();
		const total = PART + 7;
		await uploadStream(s3.client, "bucket", "k", chunks(total, 997), { partSizeBytes: PART });
		const stored = Buffer.concat(s3.parts);
		const expected: Buffer[] = [];
		for await (const chunk of chunks(total, 997)) expected.push(chunk);
		expect(stored.equals(Buffer.concat(expected))).toBe(true);
	});

	it("aborts the multipart upload when the source fails mid-stream", async () => {
		const s3 = fakeS3();
		async function* failing(): AsyncGenerator<Buffer> {
			for await (const chunk of chunks(PART + 10, 64 * 1024)) yield chunk;
			throw new Error("the dump command exited with status 1");
		}

		await expect(
			uploadStream(s3.client, "bucket", "k", failing(), { partSizeBytes: PART }),
		).rejects.toThrow(/status 1/);
		expect(s3.names()).toContain("AbortMultipartUploadCommand");
		expect(s3.names()).not.toContain("CompleteMultipartUploadCommand");
	});

	it("aborts when a part upload itself fails", async () => {
		const s3 = fakeS3({ failOnPart: 2 });
		await expect(
			uploadStream(s3.client, "bucket", "k", chunks(PART * 3, 1024 * 1024), {
				partSizeBytes: PART,
			}),
		).rejects.toThrow(/part upload failed/);
		expect(s3.names()).toContain("AbortMultipartUploadCommand");
		expect(s3.names()).not.toContain("CompleteMultipartUploadCommand");
	});
});
