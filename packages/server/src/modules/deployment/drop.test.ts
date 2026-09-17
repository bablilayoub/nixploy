import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { assertZipArchive, MAX_DROP_ARCHIVE_BYTES, storeDropArchive } from "./drop";
import { getDropZipPath } from "./paths";

const zip = (body = "content") =>
	Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(body)]);

describe("assertZipArchive", () => {
	it("accepts the local-header, empty and spanned zip magics", () => {
		expect(() => assertZipArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).not.toThrow();
		expect(() => assertZipArchive(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).not.toThrow();
		expect(() => assertZipArchive(Buffer.from([0x50, 0x4b, 0x07, 0x08]))).not.toThrow();
	});

	it("refuses anything else, so a bad upload fails now and not mid-deploy", () => {
		// A gzip tarball is the likeliest mistake.
		expect(() => assertZipArchive(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toThrow(/not a zip/);
		expect(() => assertZipArchive(Buffer.from("#!/bin/sh\n"))).toThrow(/not a zip/);
		expect(() => assertZipArchive(Buffer.alloc(0))).toThrow(/not a zip/);
	});
});

describe("storeDropArchive", () => {
	// `getDropZipPath` resolves under the config dir, so point it at a temp one.
	let configDir = "";
	const previous = process.env.NIXPLOY_CONFIG_DIR;

	beforeEach(async () => {
		configDir = await mkdtemp(path.join(tmpdir(), "nixploy-drop-"));
		process.env.NIXPLOY_CONFIG_DIR = configDir;
	});
	afterEach(async () => {
		if (previous === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
		else process.env.NIXPLOY_CONFIG_DIR = previous;
		await rm(configDir, { recursive: true, force: true });
	});

	it("writes the archive owner-only and reports its size", async () => {
		const archive = zip("hello");
		const bytes = await storeDropArchive("myapp", archive);
		expect(bytes).toBe(archive.byteLength);

		const target = getDropZipPath("myapp");
		expect(await readFile(target)).toEqual(archive);
		// Tenant source code in a shared config dir.
		expect((await stat(target)).mode & 0o777).toBe(0o600);
	});

	it("replaces a previous archive", async () => {
		await storeDropArchive("myapp", zip("first"));
		await storeDropArchive("myapp", zip("second"));
		expect((await readFile(getDropZipPath("myapp"))).toString()).toContain("second");
	});

	it("leaves no temporary file behind", async () => {
		await storeDropArchive("myapp", zip());
		await expect(stat(`${getDropZipPath("myapp")}.upload`)).rejects.toThrow();
	});

	it("refuses an empty upload", async () => {
		await expect(storeDropArchive("myapp", Buffer.alloc(0))).rejects.toThrow(/empty/);
	});

	it("refuses a non-zip before it reaches the extractor", async () => {
		await expect(storeDropArchive("myapp", Buffer.from("not a zip"))).rejects.toThrow(/not a zip/);
	});

	it("refuses an oversized archive as PAYLOAD_TOO_LARGE", async () => {
		const oversized = Buffer.concat([zip(), Buffer.alloc(MAX_DROP_ARCHIVE_BYTES)]);
		try {
			await storeDropArchive("myapp", oversized);
			expect.unreachable();
		} catch (error) {
			expect(isDomainError(error) && error.code).toBe("PAYLOAD_TOO_LARGE");
		}
	});
});
