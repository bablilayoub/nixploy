import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import {
	DOMAIN_MIDDLEWARE_KINDS,
	describeMiddleware,
	parseForwardAuthAddress,
	parseMiddlewareConfig,
	renderMiddleware,
	renderStickyCookie,
} from "./middlewares";

/** `parseMiddlewareConfig` rejects with a DomainError the panel can show. */
const rejects = (fn: () => unknown): string => {
	try {
		fn();
	} catch (error) {
		expect(isDomainError(error)).toBe(true);
		return (error as Error).message;
	}
	throw new Error("expected the call to throw");
};

describe("parseMiddlewareConfig", () => {
	it("covers every kind of the pg enum", () => {
		expect([...DOMAIN_MIDDLEWARE_KINDS]).toEqual([
			"rateLimit",
			"ipAllowList",
			"headers",
			"compress",
			"forwardAuth",
			"stickyCookie",
			"maintenance",
		]);
	});

	it("rateLimit: requires average/burst and a Go duration period", () => {
		expect(parseMiddlewareConfig("rateLimit", { average: 5, burst: 10 })).toEqual({
			average: 5,
			burst: 10,
		});
		expect(rejects(() => parseMiddlewareConfig("rateLimit", { average: 0, burst: 1 }))).toMatch(
			/rateLimit/,
		);
		expect(
			rejects(() => parseMiddlewareConfig("rateLimit", { average: 1, burst: 1, period: "1 min" })),
		).toMatch(/500ms/);
	});

	it("ipAllowList: validates IPv4/IPv6 CIDRs", () => {
		expect(
			parseMiddlewareConfig("ipAllowList", { sourceRange: ["10.0.0.0/8", "::1", "127.0.0.1/32"] })
				.sourceRange,
		).toHaveLength(3);
		expect(
			rejects(() => parseMiddlewareConfig("ipAllowList", { sourceRange: ["10.0.0.0/64"] })),
		).toMatch(/CIDR/);
		expect(rejects(() => parseMiddlewareConfig("ipAllowList", { sourceRange: ["nope"] }))).toMatch(
			/CIDR/,
		);
		expect(rejects(() => parseMiddlewareConfig("ipAllowList", { sourceRange: [] }))).toMatch(
			/ipAllowList/,
		);
	});

	it("headers: refuses proxy-managed names and CRLF values", () => {
		expect(
			rejects(() =>
				parseMiddlewareConfig("headers", {
					customRequestHeaders: { "X-Forwarded-For": "1.2.3.4" },
				}),
			),
		).toMatch(/cannot be overridden/);
		expect(
			rejects(() => parseMiddlewareConfig("headers", { customRequestHeaders: { Host: "evil" } })),
		).toMatch(/cannot be overridden/);
		expect(
			rejects(() =>
				parseMiddlewareConfig("headers", {
					customResponseHeaders: { "X-Demo": "a\r\nSet-Cookie: b=c" },
				}),
			),
		).toMatch(/control characters/);
		// Unknown Traefik options are stripped, not passed through.
		expect(
			parseMiddlewareConfig("headers", { stsSeconds: 60, sslProxyHeaders: { a: "b" } }),
		).toEqual({ stsSeconds: 60 });
	});

	it("headers: keeps safe custom headers", () => {
		expect(
			parseMiddlewareConfig("headers", {
				customResponseHeaders: { "X-Nixploy-Test": "middleware-ok" },
			}),
		).toEqual({ customResponseHeaders: { "X-Nixploy-Test": "middleware-ok" } });
	});

	it("stickyCookie: defaults to an httpOnly nixploy cookie", () => {
		expect(renderStickyCookie({})).toEqual({
			name: "nixploy_sticky",
			secure: false,
			httpOnly: true,
		});
		expect(rejects(() => parseMiddlewareConfig("stickyCookie", { name: "bad name" }))).toMatch(
			/cookie name/,
		);
	});
});

describe("parseForwardAuthAddress", () => {
	it("classifies a bare service name as internal", () => {
		const target = parseForwardAuthAddress("http://authelia:9091/api/verify");
		expect(target.scope).toBe("internal");
		if (target.scope === "internal") {
			expect(target.host).toBe("authelia");
			expect(target.port).toBe(9091);
		}
	});

	it("classifies anything with a dot or an IP literal as external", () => {
		expect(parseForwardAuthAddress("https://auth.example.com/verify").scope).toBe("external");
		expect(parseForwardAuthAddress("http://10.0.0.5:9091/verify").scope).toBe("external");
	});

	it("rejects non-http schemes and embedded credentials", () => {
		expect(rejects(() => parseForwardAuthAddress("file:///etc/passwd"))).toMatch(/http/);
		expect(rejects(() => parseForwardAuthAddress("http://user:pw@authelia:9091"))).toMatch(
			/credentials/,
		);
	});
});

describe("renderMiddleware", () => {
	it("renders the Traefik object for each kind", () => {
		expect(renderMiddleware("rateLimit", { average: 2, burst: 2, period: "1s" })).toEqual({
			rateLimit: { average: 2, burst: 2, period: "1s" },
		});
		expect(renderMiddleware("ipAllowList", { sourceRange: ["127.0.0.1/32"] })).toEqual({
			ipAllowList: { sourceRange: ["127.0.0.1/32"] },
		});
		expect(renderMiddleware("compress", {})).toEqual({ compress: {} });
		expect(renderMiddleware("forwardAuth", { address: "http://authelia:9091/api/verify" })).toEqual(
			{ forwardAuth: { address: "http://authelia:9091/api/verify" } },
		);
		expect(renderMiddleware("maintenance", {})).toEqual({
			errors: { status: ["100-599"], service: "nixploy-dashboard", query: "/__maintenance" },
		});
		// stickyCookie is a load-balancer option, not a middleware.
		expect(renderMiddleware("stickyCookie", {})).toBeNull();
	});

	it("re-validates at render time so a stale row cannot reach the YAML", () => {
		expect(rejects(() => renderMiddleware("ipAllowList", { sourceRange: ["evil"] }))).toMatch(
			/CIDR/,
		);
		expect(rejects(() => renderMiddleware("forwardAuth", { address: "ftp://x/" }))).toMatch(/http/);
	});
});

describe("describeMiddleware", () => {
	it("summarises a row for the panel and never throws", () => {
		expect(describeMiddleware("rateLimit", { average: 2, burst: 4 })).toBe("2/1s (burst 4)");
		expect(describeMiddleware("ipAllowList", { sourceRange: ["10.0.0.0/8"] })).toBe("10.0.0.0/8");
		expect(describeMiddleware("rateLimit", { nope: true })).toBe("invalid configuration");
	});
});
