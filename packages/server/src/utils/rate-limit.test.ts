import { afterEach, describe, expect, it } from "vitest";
import {
	clearFailures,
	clientIpFromRequest,
	hasRateLimitCapacity,
	ipRateLimitMax,
	lockoutStatus,
	PRIVATE_PROXY_RANGES,
	parseTrustedProxies,
	recordFailure,
	resetFailureRecords,
	takeIpRateLimitToken,
	takeRateLimitToken,
	trustedProxyCidrsForAuth,
	UNKNOWN_IP,
	UNKNOWN_IP_LIMIT_MULTIPLIER,
} from "./rate-limit";

const uniqueBucket = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

describe("takeRateLimitToken / hasRateLimitCapacity", () => {
	it("allows `max` tokens per window and reports capacity without consuming", () => {
		const key = uniqueBucket("basic");
		expect(hasRateLimitCapacity(key, 2)).toBe(true);
		expect(takeRateLimitToken(key, { windowMs: 60_000, max: 2 })).toBe(true);
		expect(hasRateLimitCapacity(key, 2)).toBe(true);
		expect(takeRateLimitToken(key, { windowMs: 60_000, max: 2 })).toBe(true);
		expect(hasRateLimitCapacity(key, 2)).toBe(false);
		expect(takeRateLimitToken(key, { windowMs: 60_000, max: 2 })).toBe(false);
	});
});

describe("takeIpRateLimitToken", () => {
	it("keeps the per-client limit for a known IP", () => {
		const bucket = uniqueBucket("known");
		expect(takeIpRateLimitToken(bucket, "203.0.113.5", { windowMs: 60_000, max: 1 })).toBe(true);
		expect(takeIpRateLimitToken(bucket, "203.0.113.5", { windowMs: 60_000, max: 1 })).toBe(false);
		// Another IP has its own bucket.
		expect(takeIpRateLimitToken(bucket, "203.0.113.6", { windowMs: 60_000, max: 1 })).toBe(true);
	});

	it("widens the shared bucket when the IP is unknown", () => {
		const bucket = uniqueBucket("unknown");
		for (let i = 0; i < UNKNOWN_IP_LIMIT_MULTIPLIER; i += 1) {
			expect(takeIpRateLimitToken(bucket, UNKNOWN_IP, { windowMs: 60_000, max: 1 })).toBe(true);
		}
		expect(takeIpRateLimitToken(bucket, UNKNOWN_IP, { windowMs: 60_000, max: 1 })).toBe(false);
		expect(ipRateLimitMax(UNKNOWN_IP, 30)).toBe(30 * UNKNOWN_IP_LIMIT_MULTIPLIER);
		expect(ipRateLimitMax(UNKNOWN_IP, 30, 500)).toBe(500);
		expect(ipRateLimitMax("203.0.113.5", 30, 500)).toBe(30);
	});
});

describe("TRUSTED_PROXIES parsing", () => {
	const original = process.env.TRUSTED_PROXIES;
	afterEach(() => {
		if (original === undefined) delete process.env.TRUSTED_PROXIES;
		else process.env.TRUSTED_PROXIES = original;
	});

	it("maps unset / 1 / list to none / all / list", () => {
		expect(parseTrustedProxies(undefined)).toEqual({ mode: "none" });
		expect(parseTrustedProxies("")).toEqual({ mode: "none" });
		expect(parseTrustedProxies("1")).toEqual({ mode: "all" });
		expect(parseTrustedProxies("10.0.0.0/8, 172.18.0.1")).toEqual({
			mode: "list",
			cidrs: ["10.0.0.0/8", "172.18.0.1"],
		});
	});

	it("gives better-auth the same trust decision", () => {
		expect(trustedProxyCidrsForAuth({ mode: "none" })).toBeUndefined();
		expect(trustedProxyCidrsForAuth({ mode: "all" })).toEqual([...PRIVATE_PROXY_RANGES]);
		expect(trustedProxyCidrsForAuth({ mode: "list", cidrs: ["10.1.2.3"] })).toEqual(["10.1.2.3"]);
	});

	it("ignores forwarded headers unless a proxy is trusted", () => {
		const req = new Request("http://local", {
			headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.2", "x-real-ip": "198.51.100.7" },
		});
		delete process.env.TRUSTED_PROXIES;
		expect(clientIpFromRequest(req)).toBe(UNKNOWN_IP);
		process.env.TRUSTED_PROXIES = "1";
		expect(clientIpFromRequest(req)).toBe("198.51.100.7");
		expect(clientIpFromRequest(new Request("http://local"))).toBe(UNKNOWN_IP);
	});
});

describe("sliding failure lockout", () => {
	const options = { windowMs: 15 * 60_000, max: 10, lockMs: 15 * 60_000 };

	afterEach(() => {
		resetFailureRecords();
	});

	it("reports no lock before the threshold and locks on the Nth failure", () => {
		const key = uniqueBucket("lock-basic");
		for (let i = 0; i < options.max - 1; i += 1) {
			expect(recordFailure(key, options).locked).toBe(false);
		}
		expect(lockoutStatus(key).locked).toBe(false);
		const tripped = recordFailure(key, options);
		expect(tripped.locked).toBe(true);
		expect(tripped.retryAfterMs).toBeGreaterThan(0);
		expect(tripped.retryAfterMs).toBeLessThanOrEqual(options.lockMs);
	});

	it("keeps reporting the lock for further attempts without extending it", () => {
		const key = uniqueBucket("lock-hold");
		for (let i = 0; i < options.max; i += 1) recordFailure(key, options);
		const first = lockoutStatus(key).retryAfterMs;
		const again = recordFailure(key, options);
		expect(again.locked).toBe(true);
		expect(again.retryAfterMs).toBeLessThanOrEqual(first);
	});

	it("keys the bucket per identity", () => {
		const a = uniqueBucket("lock-a");
		const b = uniqueBucket("lock-b");
		for (let i = 0; i < options.max; i += 1) recordFailure(a, options);
		expect(lockoutStatus(a).locked).toBe(true);
		expect(lockoutStatus(b).locked).toBe(false);
	});

	it("forgets failures on success", () => {
		const key = uniqueBucket("lock-clear");
		for (let i = 0; i < options.max - 1; i += 1) recordFailure(key, options);
		clearFailures(key);
		for (let i = 0; i < options.max - 1; i += 1) {
			expect(recordFailure(key, options).locked).toBe(false);
		}
	});

	it("drops failures that fall out of the window", () => {
		const key = uniqueBucket("lock-window");
		const short = { windowMs: 20, max: 3, lockMs: 60_000 };
		expect(recordFailure(key, short).locked).toBe(false);
		expect(recordFailure(key, short).locked).toBe(false);
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				// The two earlier failures aged out, so this is the first again.
				expect(recordFailure(key, short).locked).toBe(false);
				expect(lockoutStatus(key).locked).toBe(false);
				resolve();
			}, 40);
		});
	});

	it("is unlocked for an unknown key", () => {
		expect(lockoutStatus(uniqueBucket("lock-unknown"))).toEqual({
			locked: false,
			retryAfterMs: 0,
		});
	});
});
