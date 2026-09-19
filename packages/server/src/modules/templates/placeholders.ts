import { createHmac, randomBytes, randomUUID } from "node:crypto";

/**
 * Deploy-time placeholders in template env defaults.
 *
 * `{{generateSecret}}` is the original one (48 hex characters, fresh per
 * occurrence). The rest exist so a catalogue written for another panel's
 * `${helper}` syntax can be carried over faithfully — including its one
 * property a plain per-occurrence generator cannot give: a value generated
 * ONCE and used in several keys (the database password that also appears
 * inside `DATABASE_URL`). A trailing `:name` does that — every placeholder
 * with the same name resolves to the same value within one deploy.
 *
 *   {{generatePassword:32:db_password}}   alphanumeric, N characters
 *   {{generateBase64:64:secret_base}}     base64 of N random bytes
 *   {{generateHash:16:enc_key}}           N hex characters
 *   {{generateUuid:tenant_id}}
 *   {{generateJwt:secret_name:<base64url payload JSON>}}
 *                                         HS256, signed with the named value
 *   {{domain}}                            the domain attached at deploy
 *   {{env:OTHER_KEY}}                     another key's resolved value
 *
 * Everything is resolved here, on the panel, before the value reaches the
 * stack's .env; nothing about the grammar reaches a container.
 */

export interface PlaceholderContext {
	/** Host of the domain attached at deploy, when there is one. */
	domain?: string | null;
}

const PASSWORD_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_LENGTH = 512;

const clampLength = (raw: string | undefined, fallback: number): number => {
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.min(parsed, MAX_LENGTH);
};

export const generatePassword = (length: number): string => {
	const bytes = randomBytes(length);
	let out = "";
	for (let index = 0; index < length; index += 1) {
		out += PASSWORD_CHARSET[(bytes[index] ?? 0) % PASSWORD_CHARSET.length];
	}
	return out;
};

const base64url = (value: Buffer | string): string =>
	(typeof value === "string" ? Buffer.from(value, "utf8") : value).toString("base64url");

export const signJwtHs256 = (secret: string, payload: Record<string, unknown>): string => {
	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(payload));
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${signature}`;
};

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9]+)(?::([^{}]*))?\}\}/g;

/** True when a default carries any placeholder this module resolves. */
export const hasPlaceholders = (value: string): boolean =>
	/\{\{(generate[A-Za-z0-9]+|domain|env)(:[^{}]*)?\}\}/.test(value);

/**
 * Resolve every placeholder in a set of env defaults. Named generators are
 * memoised for the call; `{{env:KEY}}` references are resolved after the
 * generators, in as many passes as the chain is deep (bounded).
 */
export function resolveTemplateEnv(
	entries: ReadonlyArray<{ key: string; value: string }>,
	context: PlaceholderContext = {},
): Record<string, string> {
	const named = new Map<string, string>();
	const domain = context.domain?.trim() || "localhost";

	const generated = (kind: string, args: string[]): string | null => {
		const memo = (name: string | undefined, make: () => string): string => {
			if (!name) return make();
			const known = named.get(name);
			if (known !== undefined) return known;
			const value = make();
			named.set(name, value);
			return value;
		};
		switch (kind) {
			case "generateSecret":
				return memo(args[0], () => randomBytes(24).toString("hex"));
			case "generatePassword":
				return memo(args[1], () => generatePassword(clampLength(args[0], 16)));
			case "generateBase64":
				return memo(args[1], () => randomBytes(clampLength(args[0], 32)).toString("base64"));
			case "generateHash":
				return memo(args[1], () => {
					const length = clampLength(args[0], 8);
					return randomBytes(Math.ceil(length / 2))
						.toString("hex")
						.slice(0, length);
				});
			case "generateUuid":
				return memo(args[0], () => randomUUID());
			case "domain":
				return domain;
			default:
				return null;
		}
	};

	// Pass 1: generators and the domain, in declaration order so a named
	// value is created by its first use whichever key that is.
	const resolved: Record<string, string> = {};
	const pendingJwt: Array<{ key: string }> = [];
	for (const entry of entries) {
		resolved[entry.key] = entry.value.replace(
			PLACEHOLDER_RE,
			(match, kind: string, rawArgs?: string) => {
				const args = rawArgs ? rawArgs.split(":") : [];
				if (kind === "generateJwt" || kind === "env") return match;
				return generated(kind, args) ?? match;
			},
		);
		if (resolved[entry.key]?.includes("{{generateJwt:")) pendingJwt.push({ key: entry.key });
	}

	// Pass 2: JWTs, which need the named secret they are signed with.
	for (const { key } of pendingJwt) {
		resolved[key] = (resolved[key] ?? "").replace(
			/\{\{generateJwt:([^:{}]+)(?::([^{}]*))?\}\}/g,
			(match, secretName: string, payloadB64?: string) => {
				const secret = named.get(secretName) ?? resolved[secretName];
				if (!secret) return match;
				let payload: Record<string, unknown> = {};
				if (payloadB64) {
					try {
						const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
						if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
					} catch {
						return match;
					}
				}
				return signJwtHs256(secret, payload);
			},
		);
	}

	// Pass 3: references between keys, bounded so a cycle cannot spin.
	for (let pass = 0; pass < 5; pass += 1) {
		let changed = false;
		for (const key of Object.keys(resolved)) {
			const next = (resolved[key] ?? "").replace(
				/\{\{env:([A-Za-z_][A-Za-z0-9_]*)\}\}/g,
				(match, ref: string) => {
					const value = resolved[ref];
					if (value === undefined || value.includes("{{env:")) return match;
					return value;
				},
			);
			if (next !== resolved[key]) {
				resolved[key] = next;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return resolved;
}
