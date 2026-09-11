import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Payload versions. Both are AES-256-GCM; the version names the **key
 * derivation**, so a key can be re-derived years later from the stored value
 * alone:
 *
 * - `v1` — the raw 32 bytes of a 64-char hex key, or `sha256(passphrase)`.
 *   Everything written before 2026-09 is `v1`.
 * - `v2` — `scrypt(passphrase, "nixploy-encryption-v2")`. Written for
 *   passphrase keys from now on; a single unsalted SHA-256 made offline
 *   guessing of a human passphrase free (security audit 2.4).
 *
 * Hex keys keep writing `v1` — there is no KDF to strengthen.
 */
const V1 = "v1";
const V2 = "v2";

/** Domain-separating salt. Fixed so a derived key can be cached (see below). */
const SCRYPT_SALT = "nixploy-encryption-v2";
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;

/** Substrings that mark a sample/placeholder key from `.env.example` or a doc. */
const PLACEHOLDER_MARKERS = [
	"change-me",
	"changeme",
	"change_me",
	"replace-me",
	"replaceme",
	"your-key",
	"your-secret",
	"example-key",
	"placeholder",
	"insert-key",
	"todo",
];

export class EncryptionKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EncryptionKeyError";
	}
}

const MISSING_KEY_MESSAGE =
	"ENCRYPTION_KEY environment variable is not set. Generate one with: openssl rand -hex 32";

const WEAK_KEY_MESSAGE =
	"ENCRYPTION_KEY is too weak. Use a 64-char hex string (openssl rand -hex 32) " +
	"or a passphrase of at least 32 characters.";

/**
 * Raw key material, primary first. `ENCRYPTION_KEYS` is a comma-separated
 * list: the FIRST entry encrypts, every entry can decrypt. That is what makes
 * a rotation possible without downtime — set `ENCRYPTION_KEYS="new,old"`,
 * restart, run `pnpm nixploy:rotate-key`, then drop the old entry.
 * `ENCRYPTION_KEY` stays supported as the single-key form.
 */
export function encryptionKeyList(env: NodeJS.ProcessEnv = process.env): string[] {
	const list = (env.ENCRYPTION_KEYS ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (list.length > 0) return list;
	const single = (env.ENCRYPTION_KEY ?? "").trim();
	return single ? [single] : [];
}

/** Shape check for one key: 64-char hex, or a passphrase of 32+ characters. */
function assertKeyShape(raw: string): void {
	if (HEX_KEY_RE.test(raw)) return;
	if (raw.length < 32) throw new EncryptionKeyError(WEAK_KEY_MESSAGE);
}

/**
 * Refuse the sample keys that ship in `apps/web/.env.example` and the docs.
 * Called at module load so an instance started with a placeholder fails at
 * boot instead of silently "encrypting" every tenant secret with a value that
 * is public on GitHub (security audit 2.8). A missing key is NOT an error
 * here — the key is resolved lazily so importing the schema stays free.
 */
export function assertEncryptionKeyLooksReal(env: NodeJS.ProcessEnv = process.env): void {
	for (const raw of encryptionKeyList(env)) {
		const lower = raw.toLowerCase();
		const marker = PLACEHOLDER_MARKERS.find((needle) => lower.includes(needle));
		if (marker) {
			throw new EncryptionKeyError(
				`ENCRYPTION_KEY still holds the placeholder from .env.example (contains "${marker}"). ` +
					"Generate a real one with: openssl rand -hex 32",
			);
		}
		if (HEX_KEY_RE.test(raw) && /^(.)\1+$/.test(raw)) {
			throw new EncryptionKeyError(
				"ENCRYPTION_KEY is a single repeated character. Generate one with: openssl rand -hex 32",
			);
		}
		assertKeyShape(raw);
	}
}

interface KeyMaterial {
	/** Key bytes for `v1:` payloads (hex decode, or sha256 of the passphrase). */
	v1: Buffer;
	/** Key bytes for `v2:` payloads (scrypt), null for hex keys. */
	v2: Buffer | null;
	/** Version this key writes with. */
	writeVersion: typeof V1 | typeof V2;
}

const materialCache = new Map<string, KeyMaterial>();

function materialFor(raw: string): KeyMaterial {
	const cached = materialCache.get(raw);
	if (cached) return cached;
	assertKeyShape(raw);
	const material: KeyMaterial = HEX_KEY_RE.test(raw)
		? { v1: Buffer.from(raw, "hex"), v2: null, writeVersion: V1 }
		: {
				v1: createHash("sha256").update(raw, "utf8").digest(),
				// scrypt is deliberately slow, so the derived key is cached for
				// the process lifetime — the salt is fixed for exactly that.
				v2: scryptSync(raw, SCRYPT_SALT, 32, { ...SCRYPT_PARAMS }),
				writeVersion: V2,
			};
	materialCache.set(raw, material);
	return material;
}

/** Every configured key's material, primary first. Throws when none is set. */
function keyMaterials(): KeyMaterial[] {
	const keys = encryptionKeyList();
	if (keys.length === 0) throw new EncryptionKeyError(MISSING_KEY_MESSAGE);
	return keys.map(materialFor);
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM using the PRIMARY key.
 * Output: `v1:<iv>:<tag>:<data>` (hex key) or `v2:<iv>:<tag>:<data>`
 * (passphrase key, scrypt-derived).
 */
export function encrypt(plaintext: string): string {
	const [material] = keyMaterials();
	if (!material) throw new EncryptionKeyError(MISSING_KEY_MESSAGE);
	const version = material.writeVersion;
	const key = version === V2 ? material.v2 : material.v1;
	if (!key) throw new EncryptionKeyError(MISSING_KEY_MESSAGE);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [version, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function tryDecrypt(key: Buffer, ivHex: string, tagHex: string, dataHex: string): string | null {
	try {
		const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
		decipher.setAuthTag(Buffer.from(tagHex, "hex"));
		return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString(
			"utf8",
		);
	} catch {
		return null;
	}
}

/**
 * Decrypt a payload produced by {@link encrypt}, trying every configured key
 * in order (the GCM tag makes a wrong key unambiguous, so a rotation window
 * with `ENCRYPTION_KEYS="new,old"` reads both generations).
 *
 * Values without a known version prefix are returned as-is (plaintext
 * passthrough), which keeps rows written before encryption was enabled — and
 * `jsonb` columns migrated to `encryptedJson` — readable.
 */
export function decrypt(payload: string): string {
	const version = payload.startsWith(`${V1}:`) ? V1 : payload.startsWith(`${V2}:`) ? V2 : null;
	if (!version) return payload;
	const [, ivHex, tagHex, dataHex] = payload.split(":");
	if (!ivHex || !tagHex || dataHex === undefined) {
		// A `v2:` string that is not our format at all predates this version
		// and is legitimate plaintext; a malformed `v1:` never was.
		if (version === V2) return payload;
		throw new Error("Malformed encrypted payload");
	}
	let lastError: unknown = null;
	for (const material of keyMaterials()) {
		const key = version === V2 ? material.v2 : material.v1;
		if (!key) continue;
		const result = tryDecrypt(key, ivHex, tagHex, dataHex);
		if (result !== null) return result;
		lastError = new Error("Unsupported state or unable to authenticate data");
	}
	throw lastError ?? new Error("Malformed encrypted payload");
}

export function isEncrypted(value: string): boolean {
	return value.startsWith(`${V1}:`) || value.startsWith(`${V2}:`);
}

/** Version prefix of a stored payload, or null for plaintext passthrough. */
export function encryptionVersionOf(value: string): "v1" | "v2" | null {
	if (value.startsWith(`${V1}:`)) return V1;
	if (value.startsWith(`${V2}:`)) return V2;
	return null;
}

// Boot-time refusal of `.env.example` placeholders. Missing keys stay lazy.
assertEncryptionKeyLooksReal();
