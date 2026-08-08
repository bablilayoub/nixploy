/**
 * Tiny in-memory sliding-window rate limiter for public webhook endpoints.
 * Process-local only — enough to blunt accidental/abusive floods on a single
 * Nixploy instance without adding Redis.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

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

/**
 * Client IP for rate limiting. Never trust raw `X-Forwarded-For` from the
 * client unless `TRUSTED_PROXIES=1` (or a non-empty list) is set — otherwise
 * attackers rotate forged IPs and bypass the bucket.
 */
export function clientIpFromRequest(req: Request): string {
	const trustProxies =
		process.env.TRUSTED_PROXIES === "1" ||
		(process.env.TRUSTED_PROXIES ?? "").split(",").some((part) => part.trim().length > 0);
	if (trustProxies) {
		const realIp = req.headers.get("x-real-ip")?.trim();
		if (realIp) return realIp;
		const forwarded = req.headers.get("x-forwarded-for");
		if (forwarded) {
			const first = forwarded.split(",")[0]?.trim();
			if (first) return first;
		}
	}
	return "unknown";
}
