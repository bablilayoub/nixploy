import { afterEach, describe, expect, it } from "vitest";
import {
	clearFailures,
	clientIpFromHeaders,
	clientIpFromRequest,
	hasRateLimitCapacity,
	ipInCidr,
	ipRateLimitMax,
	isTrustedProxyPeer,
	lockoutStatus,
	PEER_IP_HEADER,
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

describe("ipInCidr", () => {
	it("matches IPv4 prefixes", () => {
		expect(ipInCidr("10.0.5.7", "10.0.0.0/8")).toBe(true);
		expect(ipInCidr("11.0.5.7", "10.0.0.0/8")).toBe(false);
		expect(ipInCidr("172.20.0.1", "172.16.0.0/12")).toBe(true);
		expect(ipInCidr("172.32.0.1", "172.16.0.0/12")).toBe(false);
		expect(ipInCidr("127.0.0.1", "127.0.0.0/8")).toBe(true);
	});

	it("matches IPv6 prefixes and IPv4-mapped peers", () => {
		expect(ipInCidr("fd00::1", "fc00::/7")).toBe(true);
		expect(ipInCidr("2606:4700::1", "fc00::/7")).toBe(false);
		expect(ipInCidr("::1", "::1/128")).toBe(true);
		expect(ipInCidr("::ffff:10.0.0.1", "10.0.0.0/8")).toBe(true);
	});

	it("refuses junk", () => {
		expect(ipInCidr("nope", "10.0.0.0/8")).toBe(false);
		expect(ipInCidr("10.0.0.1", "nope/8")).toBe(false);
	});
});

describe("isTrustedProxyPeer", () => {
	it("trusts a private peer under TRUSTED_PROXIES=1", () => {
		expect(isTrustedProxyPeer("10.0.0.3", { mode: "all" })).toBe(true);
		expect(isTrustedProxyPeer("203.0.113.9", { mode: "all" })).toBe(false);
	});

	it("honours an explicit proxy list", () => {
		const config = { mode: "list", cidrs: ["198.51.100.7"] } as const;
		expect(isTrustedProxyPeer("198.51.100.7", { ...config, cidrs: [...config.cidrs] })).toBe(true);
		expect(isTrustedProxyPeer("198.51.100.8", { ...config, cidrs: [...config.cidrs] })).toBe(false);
	});

	it("never trusts anything when no proxy is configured", () => {
		expect(isTrustedProxyPeer("10.0.0.3", { mode: "none" })).toBe(false);
	});

	it("stays a no-op when the peer is unknown (no header from server.ts)", () => {
		expect(isTrustedProxyPeer(undefined, { mode: "all" })).toBe(true);
	});
});

describe("clientIpFromHeaders", () => {
	const withProxies = (value: string | undefined, run: () => void) => {
		const previous = process.env.TRUSTED_PROXIES;
		if (value === undefined) delete process.env.TRUSTED_PROXIES;
		else process.env.TRUSTED_PROXIES = value;
		try {
			run();
		} finally {
			if (previous === undefined) delete process.env.TRUSTED_PROXIES;
			else process.env.TRUSTED_PROXIES = previous;
		}
	};

	it("ignores forwarded headers from an untrusted socket peer", () => {
		withProxies("1", () => {
			const headers = new Headers({
				"x-forwarded-for": "1.2.3.4",
				[PEER_IP_HEADER]: "203.0.113.9",
			});
			expect(clientIpFromHeaders(headers)).toBe(UNKNOWN_IP);
		});
	});

	it("honours forwarded headers from the reverse proxy", () => {
		withProxies("1", () => {
			const headers = new Headers({
				"x-forwarded-for": "1.2.3.4, 10.0.0.3",
				[PEER_IP_HEADER]: "10.0.0.3",
			});
			expect(clientIpFromHeaders(headers)).toBe("1.2.3.4");
		});
	});

	it("returns unknown when no proxy is trusted", () => {
		withProxies(undefined, () => {
			expect(clientIpFromHeaders(new Headers({ "x-real-ip": "1.2.3.4" }))).toBe(UNKNOWN_IP);
		});
	});
});
