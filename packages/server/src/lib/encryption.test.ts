import { describe, expect, it } from "vitest";
import { decrypt, encrypt, isEncrypted } from "./encryption";

// vitest.config.ts pins ENCRYPTION_KEY to a fixed 64-char hex string.

describe("encryption", () => {
	it("round-trips arbitrary UTF-8 text", () => {
		const samples = [
			"hello world",
			"p@ssw0rd with spaces & symbols!$`\"'",
			"unicode: héllo wörld — 日本語 🚀",
			"multi\nline\nvalue",
		];
		for (const sample of samples) {
			expect(decrypt(encrypt(sample))).toBe(sample);
		}
	});

	it("produces the v1:<iv>:<tag>:<data> format with a random IV", () => {
		const payload = encrypt("secret");
		const parts = payload.split(":");
		expect(parts).toHaveLength(4);
		expect(parts[0]).toBe("v1");
		// 12-byte IV and 16-byte GCM tag, hex-encoded.
		expect(parts[1]).toMatch(/^[0-9a-f]{24}$/);
		expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
		// Same plaintext encrypts differently every time (random IV).
		expect(encrypt("secret")).not.toBe(payload);
	});

	it("detects tampering in the ciphertext (GCM auth tag)", () => {
		const payload = encrypt("sensitive value");
		const parts = payload.split(":");
		const data = parts[3] ?? "";
		// Flip the first hex nibble of the ciphertext.
		const flipped = data.startsWith("0") ? `1${data.slice(1)}` : `0${data.slice(1)}`;
		const tampered = [...parts.slice(0, 3), flipped].join(":");
		expect(() => decrypt(tampered)).toThrow();
	});

	it("detects tampering in the auth tag", () => {
		const payload = encrypt("sensitive value");
		const parts = payload.split(":");
		const tag = parts[2] ?? "";
		const flippedTag = tag.startsWith("0") ? `1${tag.slice(1)}` : `0${tag.slice(1)}`;
		expect(() => decrypt([parts[0], parts[1], flippedTag, parts[3]].join(":"))).toThrow();
	});

	it("passes plaintext through unchanged (pre-encryption rows)", () => {
		expect(decrypt("plain-text-value")).toBe("plain-text-value");
		expect(decrypt("")).toBe("");
		expect(decrypt("v2:not-our-format")).toBe("v2:not-our-format");
	});

	it("rejects malformed v1 payloads", () => {
		expect(() => decrypt("v1:onlyiv")).toThrow("Malformed encrypted payload");
		expect(() => decrypt("v1:::")).toThrow("Malformed encrypted payload");
	});

	it("isEncrypted only flags the v1: prefix", () => {
		expect(isEncrypted(encrypt("x"))).toBe(true);
		expect(isEncrypted("v1:abc")).toBe(true);
		expect(isEncrypted("plain")).toBe(false);
		expect(isEncrypted("v2:abc")).toBe(false);
	});

	it("derives a key from a non-hex passphrase", () => {
		const original = process.env.ENCRYPTION_KEY;
		process.env.ENCRYPTION_KEY = "a-human-passphrase";
		try {
			expect(decrypt(encrypt("passphrase round-trip"))).toBe("passphrase round-trip");
		} finally {
			process.env.ENCRYPTION_KEY = original;
		}
	});

	it("throws a helpful error when ENCRYPTION_KEY is missing", () => {
		const original = process.env.ENCRYPTION_KEY;
		delete process.env.ENCRYPTION_KEY;
		try {
			expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
		} finally {
			process.env.ENCRYPTION_KEY = original;
		}
	});
});
