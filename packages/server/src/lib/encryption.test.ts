import { describe, expect, it } from "vitest";
import {
	assertEncryptionKeyLooksReal,
	decrypt,
	encrypt,
	encryptionKeyList,
	encryptionVersionOf,
	isEncrypted,
} from "./encryption";

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

	it("isEncrypted flags both versioned prefixes", () => {
		expect(isEncrypted(encrypt("x"))).toBe(true);
		expect(isEncrypted("v1:abc")).toBe(true);
		expect(isEncrypted("v2:abc")).toBe(true);
		expect(isEncrypted("plain")).toBe(false);
		expect(encryptionVersionOf("v1:a:b:c")).toBe("v1");
		expect(encryptionVersionOf("v2:a:b:c")).toBe("v2");
		expect(encryptionVersionOf("plain")).toBe(null);
	});

	it("derives a key from a non-hex passphrase with scrypt and writes v2", () => {
		const original = process.env.ENCRYPTION_KEY;
		process.env.ENCRYPTION_KEY = "a-human-passphrase-at-least-32-chars!!";
		try {
			const payload = encrypt("passphrase round-trip");
			expect(payload.startsWith("v2:")).toBe(true);
			expect(decrypt(payload)).toBe("passphrase round-trip");
		} finally {
			process.env.ENCRYPTION_KEY = original;
		}
	});

	it("rejects weak short passphrases", () => {
		const original = process.env.ENCRYPTION_KEY;
		process.env.ENCRYPTION_KEY = "too-short";
		try {
			expect(() => encrypt("x")).toThrow(/too weak/);
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

describe("key list and rotation window", () => {
	const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
		const previous: Record<string, string | undefined> = {};
		for (const [key, value] of Object.entries(env)) {
			previous[key] = process.env[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		try {
			run();
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	};

	const KEY_A = "11111111111111111111111111111111111111111111111111111111111111aa";
	const KEY_B = "22222222222222222222222222222222222222222222222222222222222222bb";

	it("parses ENCRYPTION_KEYS, primary first, and falls back to ENCRYPTION_KEY", () => {
		withEnv({ ENCRYPTION_KEYS: ` ${KEY_A} , ${KEY_B} ,, ` }, () => {
			expect(encryptionKeyList()).toEqual([KEY_A, KEY_B]);
		});
		withEnv({ ENCRYPTION_KEYS: "", ENCRYPTION_KEY: KEY_B }, () => {
			expect(encryptionKeyList()).toEqual([KEY_B]);
		});
		withEnv({ ENCRYPTION_KEYS: "", ENCRYPTION_KEY: "" }, () => {
			expect(encryptionKeyList()).toEqual([]);
		});
	});

	it("encrypts with the first key and decrypts with any of them", () => {
		let underOld = "";
		withEnv({ ENCRYPTION_KEYS: KEY_B, ENCRYPTION_KEY: undefined }, () => {
			underOld = encrypt("rotate me");
		});
		withEnv({ ENCRYPTION_KEYS: `${KEY_A},${KEY_B}`, ENCRYPTION_KEY: undefined }, () => {
			// Old ciphertext still readable, new ciphertext uses the new key.
			expect(decrypt(underOld)).toBe("rotate me");
			const underNew = encrypt("rotate me");
			expect(underNew).not.toBe(underOld);
			withEnv({ ENCRYPTION_KEYS: KEY_A }, () => {
				expect(decrypt(underNew)).toBe("rotate me");
				expect(() => decrypt(underOld)).toThrow();
			});
		});
	});
});

describe("assertEncryptionKeyLooksReal", () => {
	it("refuses the .env.example placeholder", () => {
		expect(() =>
			assertEncryptionKeyLooksReal({
				ENCRYPTION_KEY: "change-me-32-byte-hex-key-for-secrets-at-rest",
			}),
		).toThrow(/placeholder/);
	});

	it("refuses a repeated-character hex key and a short passphrase", () => {
		expect(() => assertEncryptionKeyLooksReal({ ENCRYPTION_KEY: "a".repeat(64) })).toThrow(
			/repeated character/,
		);
		expect(() => assertEncryptionKeyLooksReal({ ENCRYPTION_KEY: "short" })).toThrow(/too weak/);
	});

	it("accepts a real key and an unset key", () => {
		expect(() =>
			assertEncryptionKeyLooksReal({
				ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			}),
		).not.toThrow();
		expect(() => assertEncryptionKeyLooksReal({})).not.toThrow();
	});
});
