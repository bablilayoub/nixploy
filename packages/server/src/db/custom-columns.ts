import { customType } from "drizzle-orm/pg-core";
import { decrypt, encrypt } from "../lib/encryption";

/**
 * `text` column transparently encrypted at rest with AES-256-GCM.
 * Values are encrypted on write and decrypted on read using `ENCRYPTION_KEY`.
 * Use for secrets: env vars, DB passwords, registry/S3 credentials, private keys.
 */
export const encryptedText = customType<{
	data: string;
	driverData: string;
}>({
	dataType() {
		return "text";
	},
	toDriver(value) {
		return encrypt(value);
	},
	fromDriver(value) {
		return decrypt(value);
	},
});

/**
 * JSON blob stored as AES-256-GCM encrypted `text`. Use for config objects
 * that carry credentials (notification webhook URLs, bot tokens, SMTP
 * passwords). Reads fall back to plaintext JSON, so columns migrated from
 * `jsonb` stay readable until their next write.
 */
export const encryptedJson = customType<{
	data: unknown;
	driverData: string;
}>({
	dataType() {
		return "text";
	},
	toDriver(value) {
		return encrypt(JSON.stringify(value));
	},
	fromDriver(value) {
		return JSON.parse(decrypt(value)) as unknown;
	},
});
