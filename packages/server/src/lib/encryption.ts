import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION_PREFIX = "v1";

/**
 * Resolve the 32-byte encryption key from the `ENCRYPTION_KEY` env var.
 * Prefer a 64-char hex string (`openssl rand -hex 32`). Passphrases are
 * accepted only when at least 32 characters (stretched with SHA-256).
 * Resolved lazily so importing modules never fails — only encrypt/decrypt
 * calls require the key.
 */
function getKey(): Buffer {
	const raw = process.env.ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			"ENCRYPTION_KEY environment variable is not set. " +
				"Generate one with: openssl rand -hex 32",
		);
	}
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Buffer.from(raw, "hex");
	}
	if (raw.length < 32) {
		throw new Error(
			"ENCRYPTION_KEY is too weak. Use a 64-char hex string (openssl rand -hex 32) " +
				"or a passphrase of at least 32 characters.",
		);
	}
	return createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a UTF-8 string with AES-256-GCM. Output: `v1:<iv>:<tag>:<data>` (hex). */
export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [VERSION_PREFIX, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(
		":",
	);
}

/**
 * Decrypt a payload produced by {@link encrypt}.
 * Values without the `v1:` prefix are returned as-is (plaintext passthrough),
 * which keeps rows written before encryption was enabled readable.
 */
export function decrypt(payload: string): string {
	if (!payload.startsWith(`${VERSION_PREFIX}:`)) {
		return payload;
	}
	const [, ivHex, tagHex, dataHex] = payload.split(":");
	if (!ivHex || !tagHex || dataHex === undefined) {
		throw new Error("Malformed encrypted payload");
	}
	const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
	decipher.setAuthTag(Buffer.from(tagHex, "hex"));
	return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString(
		"utf8",
	);
}

export function isEncrypted(value: string): boolean {
	return value.startsWith(`${VERSION_PREFIX}:`);
}
