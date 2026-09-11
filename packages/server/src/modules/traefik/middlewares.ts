/**
 * Per-domain Traefik middlewares.
 *
 * Nixploy deliberately has **no raw-YAML escape hatch**: every middleware a
 * tenant can attach to a domain is one of the closed set below, each with a
 * hand-written zod schema and a hand-written renderer. Nothing a tenant types
 * reaches the dynamic YAML without passing through `parseMiddlewareConfig`,
 * and the writer re-parses on render, so rows written before a validation
 * tightened up can never produce a config the current rules reject.
 *
 * Pure module (no db / fs imports) so it can be unit-tested and imported from
 * both the writer and the routers.
 */

import { isIP } from "node:net";
import { z } from "zod";
import { badRequest } from "../errors";

/** Middleware kinds, mirroring the `domain_middleware_kind` pg enum. */
export const DOMAIN_MIDDLEWARE_KINDS = [
	"rateLimit",
	"ipAllowList",
	"headers",
	"compress",
	"forwardAuth",
	"stickyCookie",
	"maintenance",
] as const;

export type DomainMiddlewareKind = (typeof DOMAIN_MIDDLEWARE_KINDS)[number];

export const domainMiddlewareKindSchema = z.enum(DOMAIN_MIDDLEWARE_KINDS);

// ─── Shared value validators ─────────────────────────────────────────────────

/** Go duration accepted by Traefik (`10s`, `1m`, `500ms`). */
const durationSchema = z
	.string()
	.regex(/^\d{1,6}(ms|s|m|h)$/, "Period must look like 500ms, 10s, 1m or 1h");

/**
 * IPv4/IPv6 address or CIDR block. Traefik rejects a malformed `sourceRange`
 * by dropping the whole middleware, which would silently *open* the route.
 */
const cidrSchema = z.string().refine((value) => {
	const [address, prefix, ...rest] = value.split("/");
	if (rest.length > 0 || !address) return false;
	const family = isIP(address);
	if (family === 0) return false;
	if (prefix === undefined) return true;
	if (!/^\d{1,3}$/.test(prefix)) return false;
	const bits = Number(prefix);
	return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}, "Must be an IP address or CIDR block (e.g. 10.0.0.0/8)");

/** RFC 7230 header field-name token. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]{1,64}$/;

/**
 * Header names a tenant may never set. Traefik populates `X-Forwarded-*` and
 * `X-Real-Ip` from the real connection and the panel trusts them for client-IP
 * rate limiting; `Host` decides which router the *next* hop picks; the rest are
 * hop-by-hop/framing headers that corrupt the response when forged.
 */
const RESERVED_HEADER_NAMES = new Set(
	[
		"host",
		"x-real-ip",
		"forwarded",
		"connection",
		"keep-alive",
		"proxy-authenticate",
		"proxy-authorization",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
		"content-length",
	].map((name) => name.toLowerCase()),
);

const assertHeaderName = (name: string): string => {
	if (!HEADER_NAME_RE.test(name)) {
		throw badRequest(`Invalid header name: ${name}`);
	}
	const lower = name.toLowerCase();
	if (lower.startsWith("x-forwarded-") || RESERVED_HEADER_NAMES.has(lower)) {
		throw badRequest(`Header "${name}" is managed by the proxy and cannot be overridden`);
	}
	return name;
};

/**
 * Header values: no CR/LF (response splitting) and no other control
 * characters. Checked by char code rather than a regex — a regex with a
 * control-character class is itself a lint error, and this reads clearer.
 */
const hasControlCharacters = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
};

const headerValueSchema = z
	.string()
	.max(1024)
	.refine((value) => !hasControlCharacters(value), "Header value has control characters");

const headerMapSchema = z
	.record(z.string(), headerValueSchema)
	.refine((value) => Object.keys(value).length <= 30, "At most 30 headers")
	.transform((value) => {
		const out: Record<string, string> = {};
		for (const [name, headerValue] of Object.entries(value)) {
			out[assertHeaderName(name)] = headerValue;
		}
		return out;
	});

// ─── Per-kind config schemas ─────────────────────────────────────────────────

const rateLimitConfigSchema = z.object({
	/** Requests per `period` per source IP. */
	average: z.number().int().min(1).max(1_000_000),
	burst: z.number().int().min(1).max(1_000_000),
	period: durationSchema.optional(),
});

const ipAllowListConfigSchema = z.object({
	sourceRange: z.array(cidrSchema).min(1).max(50),
});

const headersConfigSchema = z
	.object({
		customRequestHeaders: headerMapSchema.optional(),
		customResponseHeaders: headerMapSchema.optional(),
		accessControlAllowOriginList: z.array(z.string().max(255)).max(20).optional(),
		accessControlAllowMethods: z
			.array(z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]))
			.max(7)
			.optional(),
		accessControlAllowHeaders: z.array(z.string().max(64)).max(30).optional(),
		accessControlAllowCredentials: z.boolean().optional(),
		accessControlMaxAge: z.number().int().min(0).max(86_400).optional(),
		stsSeconds: z.number().int().min(0).max(63_072_000).optional(),
		stsIncludeSubdomains: z.boolean().optional(),
		stsPreload: z.boolean().optional(),
		frameDeny: z.boolean().optional(),
		contentTypeNosniff: z.boolean().optional(),
		browserXssFilter: z.boolean().optional(),
		referrerPolicy: z
			.enum([
				"no-referrer",
				"no-referrer-when-downgrade",
				"origin",
				"origin-when-cross-origin",
				"same-origin",
				"strict-origin",
				"strict-origin-when-cross-origin",
				"unsafe-url",
			])
			.optional(),
		contentSecurityPolicy: headerValueSchema.max(2048).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, "Configure at least one header option");

const compressConfigSchema = z.object({
	minResponseBodyBytes: z.number().int().min(0).max(10_485_760).optional(),
});

const forwardAuthConfigSchema = z.object({
	/**
	 * Auth endpoint. Validated for SSRF by the caller
	 * ({@link parseForwardAuthAddress} + the router's org-ownership check):
	 * a private target is only allowed when it is another service of the same
	 * organization (`http://<appName>:<port>`).
	 */
	address: z.string().min(1).max(512),
	trustForwardHeader: z.boolean().optional(),
	authResponseHeaders: z
		.array(z.string().regex(HEADER_NAME_RE, "Invalid header name"))
		.max(20)
		.optional(),
});

const stickyCookieConfigSchema = z.object({
	name: z
		.string()
		.regex(/^[A-Za-z0-9!#$%&'*+\-.^_`|~]{1,64}$/, "Invalid cookie name")
		.optional(),
	secure: z.boolean().optional(),
	httpOnly: z.boolean().optional(),
	sameSite: z.enum(["none", "lax", "strict"]).optional(),
});

const maintenanceConfigSchema = z.object({});

/** One zod schema per kind — the only way a `config` jsonb blob is read. */
export const DOMAIN_MIDDLEWARE_CONFIG_SCHEMAS = {
	rateLimit: rateLimitConfigSchema,
	ipAllowList: ipAllowListConfigSchema,
	headers: headersConfigSchema,
	compress: compressConfigSchema,
	forwardAuth: forwardAuthConfigSchema,
	stickyCookie: stickyCookieConfigSchema,
	maintenance: maintenanceConfigSchema,
} as const;

export type DomainMiddlewareConfig = {
	[K in DomainMiddlewareKind]: z.infer<(typeof DOMAIN_MIDDLEWARE_CONFIG_SCHEMAS)[K]>;
};

/**
 * Validate a stored/incoming `config` blob against its kind. Throws a
 * `DomainError` (BAD_REQUEST) with the zod message so the panel, REST and MCP
 * all surface the same text.
 */
export const parseMiddlewareConfig = <K extends DomainMiddlewareKind>(
	kind: K,
	config: unknown,
): DomainMiddlewareConfig[K] => {
	const schema = DOMAIN_MIDDLEWARE_CONFIG_SCHEMAS[kind];
	const result = schema.safeParse(config ?? {});
	if (!result.success) {
		const issue = result.error.issues[0];
		const path = issue?.path.join(".");
		throw badRequest(
			`Invalid ${kind} middleware: ${path ? `${path} — ` : ""}${issue?.message ?? "invalid config"}`,
		);
	}
	return result.data as DomainMiddlewareConfig[K];
};

// ─── forwardAuth address ─────────────────────────────────────────────────────

export type ForwardAuthTarget =
	| { scope: "internal"; host: string; port: number | null; url: URL }
	| { scope: "external"; url: URL };

/**
 * Split a forwardAuth address into "another container on this instance"
 * (a bare Docker/Swarm service name — `http://authelia:9091/api/verify`) and
 * "somewhere on the internet". The caller must then either verify the internal
 * host belongs to the same organization or run `assertSafeOutboundUrl` on the
 * external one; a bare service name never resolves in the panel's DNS, so it
 * cannot go through the generic SSRF guard.
 */
export const parseForwardAuthAddress = (address: string): ForwardAuthTarget => {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw badRequest("forwardAuth address must be a URL (e.g. http://authelia:9091/api/verify)");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw badRequest("forwardAuth address must be http(s)");
	}
	if (url.username || url.password) {
		throw badRequest("forwardAuth address must not embed credentials");
	}
	const host = url.hostname.toLowerCase();
	// A Docker service name: single label, no dots, not an IP literal.
	if (/^[a-z0-9][a-z0-9_-]*$/.test(host) && isIP(host) === 0) {
		return {
			scope: "internal",
			host,
			port: url.port ? Number(url.port) : null,
			url,
		};
	}
	return { scope: "external", url };
};

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Traefik middleware objects this module can emit. */
export type RenderedMiddleware =
	| { rateLimit: { average: number; burst: number; period?: string } }
	| { ipAllowList: { sourceRange: string[] } }
	| { headers: Record<string, unknown> }
	| { compress: Record<string, unknown> }
	| {
			forwardAuth: {
				address: string;
				trustForwardHeader?: boolean;
				authResponseHeaders?: string[];
			};
	  }
	| { errors: { status: string[]; service: string; query: string } };

/** Cookie config applied to the domain's service load balancer. */
export interface StickyCookie {
	name?: string;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: string;
}

/**
 * Service that serves the maintenance page, defined once in
 * `00-nixploy-dashboard.yml` (the panel itself). Traefik's file provider
 * merges every file into one configuration, so a tenant router can reference
 * it by name.
 */
export const MAINTENANCE_SERVICE = "nixploy-dashboard";
/** Unauthenticated static route in the panel (`apps/web/src/app/__maintenance`). */
export const MAINTENANCE_QUERY = "/__maintenance";

/**
 * Render one middleware row. Returns `null` for `stickyCookie`, which is not a
 * middleware at all — it configures the service's load balancer, so the writer
 * handles it separately (see {@link renderStickyCookie}).
 */
export const renderMiddleware = (
	kind: DomainMiddlewareKind,
	config: unknown,
): RenderedMiddleware | null => {
	switch (kind) {
		case "rateLimit": {
			const parsed = parseMiddlewareConfig("rateLimit", config);
			return {
				rateLimit: {
					average: parsed.average,
					burst: parsed.burst,
					...(parsed.period ? { period: parsed.period } : {}),
				},
			};
		}
		case "ipAllowList": {
			const parsed = parseMiddlewareConfig("ipAllowList", config);
			return { ipAllowList: { sourceRange: parsed.sourceRange } };
		}
		case "headers": {
			const parsed = parseMiddlewareConfig("headers", config);
			// zod strips unknown keys, so this object only carries the
			// allow-listed Traefik options above.
			return { headers: parsed as Record<string, unknown> };
		}
		case "compress": {
			const parsed = parseMiddlewareConfig("compress", config);
			return { compress: parsed as Record<string, unknown> };
		}
		case "forwardAuth": {
			const parsed = parseMiddlewareConfig("forwardAuth", config);
			// Re-check the shape at render time: a row written by an older
			// validation can never emit an address the current rules reject.
			const target = parseForwardAuthAddress(parsed.address);
			return {
				forwardAuth: {
					address: target.url.toString(),
					...(parsed.trustForwardHeader !== undefined
						? { trustForwardHeader: parsed.trustForwardHeader }
						: {}),
					...(parsed.authResponseHeaders?.length
						? { authResponseHeaders: parsed.authResponseHeaders }
						: {}),
				},
			};
		}
		case "maintenance": {
			parseMiddlewareConfig("maintenance", config);
			// Every response the backend produces (or fails to produce) is
			// replaced by the panel's maintenance page — a traffic pause that
			// keeps the tenant's own host and certificate.
			return {
				errors: {
					status: ["100-599"],
					service: MAINTENANCE_SERVICE,
					query: MAINTENANCE_QUERY,
				},
			};
		}
		case "stickyCookie":
			parseMiddlewareConfig("stickyCookie", config);
			return null;
	}
};

/** Load-balancer sticky-session cookie for a `stickyCookie` row. */
export const renderStickyCookie = (config: unknown): StickyCookie => {
	const parsed = parseMiddlewareConfig("stickyCookie", config);
	return {
		name: parsed.name ?? "nixploy_sticky",
		secure: parsed.secure ?? false,
		httpOnly: parsed.httpOnly ?? true,
		...(parsed.sameSite ? { sameSite: parsed.sameSite } : {}),
	};
};

/** Human-readable one-liner for the panel's middleware table. */
export const describeMiddleware = (kind: DomainMiddlewareKind, config: unknown): string => {
	try {
		switch (kind) {
			case "rateLimit": {
				const parsed = parseMiddlewareConfig("rateLimit", config);
				return `${parsed.average}/${parsed.period ?? "1s"} (burst ${parsed.burst})`;
			}
			case "ipAllowList":
				return parseMiddlewareConfig("ipAllowList", config).sourceRange.join(", ");
			case "headers": {
				const parsed = parseMiddlewareConfig("headers", config);
				return Object.keys(parsed).join(", ");
			}
			case "compress":
				return "gzip / brotli responses";
			case "forwardAuth":
				return parseMiddlewareConfig("forwardAuth", config).address;
			case "stickyCookie":
				return renderStickyCookie(config).name ?? "nixploy_sticky";
			case "maintenance":
				return "serve the maintenance page";
		}
	} catch {
		return "invalid configuration";
	}
};
