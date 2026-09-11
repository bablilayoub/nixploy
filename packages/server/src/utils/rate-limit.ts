/**
 * Tiny in-memory sliding-window rate limiter for public webhook endpoints.
 * Process-local only — enough to blunt accidental/abusive floods on a single
 * Nixploy instance without adding Redis.
 */

import { ipToBytes } from "./public-url";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Expired buckets are only overwritten when their key is hit again, so a
 * scanner rotating keys (or IPs) grows the map forever. Sweep every minute,
 * and never more often than that — the sweep is O(size).
 */
const BUCKET_SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweepExpiredBuckets(now: number): void {
	if (now - lastSweepAt < BUCKET_SWEEP_INTERVAL_MS) return;
	lastSweepAt = now;
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) buckets.delete(key);
	}
}

/** Test helper — drop every rate-limit bucket. */
export function resetRateLimitBuckets(): void {
	buckets.clear();
	lastSweepAt = 0;
}

/** Sentinel returned by {@link clientIpFromRequest} when no trusted IP is available. */
export const UNKNOWN_IP = "unknown";

/**
 * When the client IP cannot be resolved every caller shares one bucket, so a
 * per-IP limit sized for a single client would throttle the whole instance.
 * Widen it by this factor instead of collapsing to the per-client value.
 */
export const UNKNOWN_IP_LIMIT_MULTIPLIER = 20;

export function takeRateLimitToken(
	key: string,
	options: { windowMs: number; max: number } = { windowMs: 60_000, max: 60 },
): boolean {
	const now = Date.now();
	sweepExpiredBuckets(now);
	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + options.windowMs });
		return true;
	}
	if (existing.count >= options.max) {
		return false;
	}
	existing.count += 1;
	return true;
}

/** True when {@link takeRateLimitToken} would currently succeed (no token consumed). */
export function hasRateLimitCapacity(key: string, max: number): boolean {
	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= Date.now()) return true;
	return existing.count < max;
}

/** Milliseconds until `key`'s window resets (0 when it has no live bucket). */
export function rateLimitResetInMs(key: string): number {
	const existing = buckets.get(key);
	if (!existing) return 0;
	return Math.max(0, existing.resetAt - Date.now());
}

/**
 * Attached as the `cause` of a `TOO_MANY_REQUESTS` error so a transport can
 * answer with a `Retry-After` header instead of a bare status.
 *
 * tRPC keeps `cause` intact through `getTRPCErrorFromUnknown`, which is how the
 * REST adapter (`apps/web/src/app/api/[...rest]/route.ts`) reads it back with
 * {@link retryAfterSecondsFromError}.
 */
export class RateLimitedCause extends Error {
	readonly retryAfterSeconds: number;

	constructor(retryAfterMs: number) {
		const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
		super(`Retry after ${seconds}s`);
		this.name = "RateLimitedCause";
		this.retryAfterSeconds = seconds;
	}
}

/** Seconds to wait before retrying, when `error` carries a {@link RateLimitedCause}. */
export function retryAfterSecondsFromError(error: unknown): number | null {
	let current: unknown = error;
	// Walk a short cause chain: tRPC wraps a thrown cause once, no deeper.
	for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
		if (current instanceof RateLimitedCause) return current.retryAfterSeconds;
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/**
 * Per-IP bucket that degrades gracefully when the IP is unknown (no trusted
 * proxy configured): the shared "unknown" bucket gets a much larger limit so a
 * single busy client cannot 429 every other caller of the instance.
 */
export function takeIpRateLimitToken(
	bucket: string,
	ip: string,
	options: { windowMs: number; max: number; unknownIpMax?: number },
): boolean {
	const max =
		ip === UNKNOWN_IP
			? (options.unknownIpMax ?? options.max * UNKNOWN_IP_LIMIT_MULTIPLIER)
			: options.max;
	return takeRateLimitToken(`${bucket}:${ip}`, { windowMs: options.windowMs, max });
}

/** Effective per-IP limit for `ip` (see {@link takeIpRateLimitToken}). */
export function ipRateLimitMax(ip: string, max: number, unknownIpMax?: number): number {
	return ip === UNKNOWN_IP ? (unknownIpMax ?? max * UNKNOWN_IP_LIMIT_MULTIPLIER) : max;
}

// ── sliding failure lockout ─────────────────────────────────────────────────
//
// Per-IP limits do not stop a distributed credential-stuffing run against one
// account, so password sign-in additionally counts failures per **email**: N
// failures inside `windowMs` lock that address for `lockMs`. Process-local like
// every other bucket here (single-replica by design); a restart clears locks.

type FailureRecord = { failures: number[]; lockedUntil: number };

const failureRecords = new Map<string, FailureRecord>();

export interface SlidingLockoutOptions {
	/** Failures older than this stop counting. */
	windowMs: number;
	/** Failures inside the window that trigger a lock. */
	max: number;
	/** How long the lock lasts once triggered. */
	lockMs: number;
}

export interface LockoutState {
	locked: boolean;
	/** Milliseconds until the lock lifts (0 when not locked). */
	retryAfterMs: number;
}

const lockoutState = (record: FailureRecord | undefined, now: number): LockoutState =>
	record && record.lockedUntil > now
		? { locked: true, retryAfterMs: record.lockedUntil - now }
		: { locked: false, retryAfterMs: 0 };

/** Current lock state for `key` without recording anything. */
export function lockoutStatus(key: string): LockoutState {
	return lockoutState(failureRecords.get(key), Date.now());
}

/**
 * Record one failed attempt for `key` and report the resulting lock state.
 * Returns `locked: true` on the attempt that trips the threshold as well as
 * for every attempt while the lock holds.
 */
export function recordFailure(key: string, options: SlidingLockoutOptions): LockoutState {
	const now = Date.now();
	const record = failureRecords.get(key) ?? { failures: [], lockedUntil: 0 };
	if (record.lockedUntil > now) {
		failureRecords.set(key, record);
		return lockoutState(record, now);
	}
	record.failures = record.failures.filter((at) => at > now - options.windowMs);
	record.failures.push(now);
	if (record.failures.length >= options.max) {
		record.lockedUntil = now + options.lockMs;
		record.failures = [];
	}
	failureRecords.set(key, record);
	// Keep the map from growing without bound on a scanned instance: drop
	// records that carry neither a live lock nor recent failures.
	if (failureRecords.size > 5_000) {
		for (const [existingKey, existing] of failureRecords) {
			if (existing.lockedUntil <= now && existing.failures.length === 0) {
				failureRecords.delete(existingKey);
			}
		}
	}
	return lockoutState(record, now);
}

/** Forget the failure history for `key` (successful sign-in). */
export function clearFailures(key: string): void {
	failureRecords.delete(key);
}

/** Test helper — drops every recorded failure and lock. */
export function resetFailureRecords(): void {
	failureRecords.clear();
}

/**
 * RFC 1918 + loopback + ULA ranges: what `TRUSTED_PROXIES=1` means in the
 * reference install (Traefik reaches the panel over the Swarm overlay /
 * docker_gwbridge, both private ranges).
 */
export const PRIVATE_PROXY_RANGES = [
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"127.0.0.0/8",
	"fc00::/7",
	"::1/128",
] as const;

export type TrustedProxyConfig =
	| { mode: "none" }
	| { mode: "all" }
	| { mode: "list"; cidrs: string[] };

/**
 * Parse `TRUSTED_PROXIES`: unset/empty → no proxy trusted; `1` → the panel sits
 * behind a proxy that sanitizes forwarded headers (Traefik) → trust them;
 * otherwise a comma-separated list of IPs / CIDRs of the proxies in front.
 */
export function parseTrustedProxies(raw = process.env.TRUSTED_PROXIES): TrustedProxyConfig {
	const value = (raw ?? "").trim();
	if (!value) return { mode: "none" };
	if (value === "1" || value.toLowerCase() === "true") return { mode: "all" };
	const cidrs = value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return cidrs.length > 0 ? { mode: "list", cidrs } : { mode: "none" };
}

/**
 * CIDR list for better-auth's `advanced.ipAddress.trustedProxies` so its
 * limiter resolves the same client IP as {@link clientIpFromRequest}.
 * Returns `undefined` when no proxy is trusted (better-auth default).
 */
export function trustedProxyCidrsForAuth(
	config: TrustedProxyConfig = parseTrustedProxies(),
): string[] | undefined {
	if (config.mode === "all") return [...PRIVATE_PROXY_RANGES];
	if (config.mode === "list") return config.cidrs;
	return undefined;
}

/** True when `ip` falls inside `cidr` (v4 or v6, prefix length in bits). */
export function ipInCidr(ip: string, cidr: string): boolean {
	const slash = cidr.lastIndexOf("/");
	const network = slash === -1 ? cidr : cidr.slice(0, slash);
	const bits = slash === -1 ? null : Number.parseInt(cidr.slice(slash + 1), 10);
	const ipBytes = ipToBytes(ip);
	const netBytes = ipToBytes(network);
	if (!ipBytes || !netBytes) return false;
	// Compare an IPv4-mapped IPv6 peer (::ffff:10.0.0.1) against IPv4 CIDRs.
	const unmap = (bytes: Uint8Array): Uint8Array =>
		bytes.length === 16 &&
		bytes.slice(0, 10).every((b) => b === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff
			? bytes.slice(12)
			: bytes;
	const a = unmap(ipBytes);
	const b = unmap(netBytes);
	if (a.length !== b.length) return false;
	const prefix = bits === null || !Number.isFinite(bits) ? a.length * 8 : bits;
	if (prefix < 0 || prefix > a.length * 8) return false;
	const fullBytes = prefix >> 3;
	for (let i = 0; i < fullBytes; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	const remainder = prefix & 7;
	if (remainder === 0) return true;
	const mask = 0xff << (8 - remainder);
	return ((a[fullBytes] ?? 0) & mask) === ((b[fullBytes] ?? 0) & mask);
}

/**
 * Header `apps/web/server.ts` sets from `req.socket.remoteAddress` before
 * handing the request to Next: the Fetch `Request` a route handler receives
 * carries no socket, so the actual TCP peer has to travel as a header.
 *
 * Absent header ⇒ the check is a no-op and behaviour matches the previous
 * releases (forwarded headers trusted whenever `TRUSTED_PROXIES` is set).
 * Present header ⇒ forwarded headers are trusted only when the peer itself is
 * a trusted proxy, which is what stops a tenant container from reaching the
 * panel directly at `nixploy:3000` with a forged `X-Forwarded-For`
 * (security audit 2.10).
 */
export const PEER_IP_HEADER = "x-nixploy-peer-ip";

/** True when the TCP peer may set forwarded headers under `config`. */
export function isTrustedProxyPeer(
	peerIp: string | null | undefined,
	config: TrustedProxyConfig = parseTrustedProxies(),
): boolean {
	if (config.mode === "none") return false;
	const peer = peerIp?.trim();
	// No peer information available (older server.ts, non-HTTP transports):
	// fall back to the configured policy rather than dropping every limit.
	if (!peer) return true;
	const ranges: string[] = config.mode === "all" ? [...PRIVATE_PROXY_RANGES] : config.cidrs;
	return ranges.some((range) => ipInCidr(peer, range));
}

/**
 * Client IP for rate limiting. Never trust raw `X-Forwarded-For` from the
 * client unless `TRUSTED_PROXIES=1` (or a non-empty list) is set **and** the
 * socket peer is itself one of those proxies — otherwise attackers rotate
 * forged IPs and bypass the bucket.
 */
export function clientIpFromRequest(req: Request): string {
	return clientIpFromHeaders(req.headers);
}

/** {@link clientIpFromRequest} for callers that only hold the headers. */
export function clientIpFromHeaders(headers: Headers): string {
	const config = parseTrustedProxies();
	if (config.mode === "none") return UNKNOWN_IP;
	const peer = headers.get(PEER_IP_HEADER);
	if (!isTrustedProxyPeer(peer, config)) return UNKNOWN_IP;
	const realIp = headers.get("x-real-ip")?.trim();
	if (realIp) return realIp;
	const forwarded = headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}
	return UNKNOWN_IP;
}

/** Raw `User-Agent`, trimmed to a column-friendly length. */
export function userAgentFromHeaders(headers: Headers | null | undefined): string | null {
	const value = headers?.get("user-agent")?.trim();
	return value ? value.slice(0, 512) : null;
}
