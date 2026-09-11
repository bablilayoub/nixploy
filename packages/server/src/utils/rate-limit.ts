/**
 * Tiny in-memory sliding-window rate limiter for public webhook endpoints.
 * Process-local only — enough to blunt accidental/abusive floods on a single
 * Nixploy instance without adding Redis.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

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

/**
 * Client IP for rate limiting. Never trust raw `X-Forwarded-For` from the
 * client unless `TRUSTED_PROXIES=1` (or a non-empty list) is set — otherwise
 * attackers rotate forged IPs and bypass the bucket.
 */
export function clientIpFromRequest(req: Request): string {
	const config = parseTrustedProxies();
	if (config.mode === "none") return UNKNOWN_IP;
	const realIp = req.headers.get("x-real-ip")?.trim();
	if (realIp) return realIp;
	const forwarded = req.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}
	return UNKNOWN_IP;
}
