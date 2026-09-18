import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { signingKeys } from "../../lib/encryption";

/**
 * The two tokens forward-auth hands to a browser.
 *
 * Both are `<payload>.<hmac>`, base64url, signed with a key derived from the
 * `ENCRYPTION_KEYS` chain: **signed with the first, accepted from any**, so
 * rotating the chain is a rotation rather than a mass sign-out. There is no
 * server-side session table — a protected app can be behind Traefik on a host
 * that never reaches Postgres, and a stateless cookie is what lets the verify
 * endpoint answer without a query on every request.
 *
 * Every payload is bound to the host it was issued for. Cookies are host-only
 * anyway, but the binding means a cookie that somehow arrives on another
 * protected domain (a broadened Domain attribute, a shared proxy, an operator
 * copying a header) is refused rather than accepted as that domain's session.
 */

/** HKDF-ish info strings, so the two token kinds cannot be swapped. */
const SESSION_INFO = "app-auth-session";
const CODE_INFO = "app-auth-code";

/** The session cookie's name. Host-only, HttpOnly, SameSite=Lax. */
export const APP_AUTH_COOKIE = "nixploy_app_auth";

/** One-time exchange codes are short-lived: they travel in a URL. */
export const CODE_TTL_SECONDS = 120;

const b64url = (input: Buffer | string): string =>
	Buffer.from(input as never).toString("base64url");

const sign = (info: string, payload: string): string =>
	b64url(
		createHmac("sha256", signingKeys(info)[0] as Buffer)
			.update(payload)
			.digest(),
	);

/** Constant-time compare of two base64url signatures of equal expected length. */
const signatureMatches = (info: string, payload: string, provided: string): boolean => {
	let ok = false;
	for (const key of signingKeys(info)) {
		const expected = Buffer.from(
			createHmac("sha256", key).update(payload).digest().toString("base64url"),
		);
		const given = Buffer.from(provided);
		// Compare every key even after a match: bailing early would leak which
		// key in the chain signed the token through timing.
		if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
	}
	return ok;
};

function encode(info: string, payload: object): string {
	const body = b64url(JSON.stringify(payload));
	return `${body}.${sign(info, body)}`;
}

function decode<T>(info: string, token: string | null | undefined): T | null {
	if (!token) return null;
	const dot = token.lastIndexOf(".");
	if (dot <= 0) return null;
	const body = token.slice(0, dot);
	const signature = token.slice(dot + 1);
	if (!signatureMatches(info, body, signature)) return null;
	try {
		return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
	} catch {
		return null;
	}
}

/* -------------------------------------------------------------------------- */
/*  Session cookie                                                            */
/* -------------------------------------------------------------------------- */

export interface AppAuthSession {
	/** User id. */
	u: string;
	/** Email. */
	e: string;
	/** Display name, or null. */
	n: string | null;
	/** Groups handed upstream — the org role plus every team name. */
	g: string[];
	/** Host this session was issued for. */
	h: string;
	/** Expiry, epoch seconds. */
	x: number;
}

export const issueSessionCookie = (
	session: Omit<AppAuthSession, "x">,
	ttlSeconds: number,
): string => encode(SESSION_INFO, { ...session, x: Math.floor(Date.now() / 1000) + ttlSeconds });

/** Verify a cookie for one host. Returns null for anything not currently valid. */
export function readSessionCookie(
	token: string | null | undefined,
	host: string,
): AppAuthSession | null {
	const session = decode<AppAuthSession>(SESSION_INFO, token);
	if (!session) return null;
	if (typeof session.x !== "number" || session.x <= Math.floor(Date.now() / 1000)) return null;
	if (session.h !== host) return null;
	return session;
}

/* -------------------------------------------------------------------------- */
/*  One-time exchange code                                                    */
/* -------------------------------------------------------------------------- */

export interface AppAuthCode extends Omit<AppAuthSession, "x"> {
	/** Replay id. */
	j: string;
	/** Where to send the browser after the cookie is set (a path). */
	r: string;
	/** Cookie lifetime to mint, seconds. */
	t: number;
	/** Expiry, epoch seconds. */
	x: number;
}

export const issueExchangeCode = (payload: Omit<AppAuthCode, "j" | "x">): string =>
	encode(CODE_INFO, {
		...payload,
		j: randomUUID(),
		x: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
	});

/**
 * Replay guard.
 *
 * In memory and process-local, like the deploy queue and the rate limiters —
 * `multi-replica nixploy is unsupported by design`, and a code lives for two
 * minutes. On `globalThis` for the usual reason: `transpilePackages` evaluates
 * this package twice, and a set that the callback route cannot see is not a
 * guard at all.
 */
const globalForCodes = globalThis as typeof globalThis & {
	__nixployAppAuthCodes?: Map<string, number>;
};
globalForCodes.__nixployAppAuthCodes ??= new Map<string, number>();
const usedCodes = globalForCodes.__nixployAppAuthCodes;

/** Verify and consume a code for one host. Returns null when it cannot be used. */
export function consumeExchangeCode(
	token: string | null | undefined,
	host: string,
): AppAuthCode | null {
	const code = decode<AppAuthCode>(CODE_INFO, token);
	if (!code) return null;
	const now = Math.floor(Date.now() / 1000);
	if (typeof code.x !== "number" || code.x <= now) return null;
	if (code.h !== host) return null;
	if (typeof code.j !== "string" || usedCodes.has(code.j)) return null;

	// Evict expired ids on the way past; the map only ever holds two minutes of
	// traffic, so there is nothing to schedule.
	for (const [id, expiry] of usedCodes) {
		if (expiry <= now) usedCodes.delete(id);
	}
	usedCodes.set(code.j, code.x);
	return code;
}

/**
 * Sanitize the post-login destination.
 *
 * It arrives from `X-Forwarded-Uri` and travels through a redirect, so it is
 * attacker-controlled. Only a single-slash absolute path is kept — `//host`
 * and `https://host` are open redirects, and anything else falls back to `/`.
 */
export function safeReturnPath(raw: string | null | undefined): string {
	if (!raw?.startsWith("/") || raw.startsWith("//")) return "/";
	if (raw.includes("\\") || /[\r\n]/.test(raw)) return "/";
	return raw.slice(0, 2048);
}
