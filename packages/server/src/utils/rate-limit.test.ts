import { afterEach, describe, expect, it } from "vitest";
import {
	clientIpFromRequest,
	hasRateLimitCapacity,
	ipRateLimitMax,
	PRIVATE_PROXY_RANGES,
	parseTrustedProxies,
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
