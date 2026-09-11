import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inArray } from "drizzle-orm";
import { stringify } from "yaml";
import { db } from "../../db";
import { certificates } from "../../db/schema";
import { execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { badRequest } from "../errors";
import type { DomainMiddlewareKind, RenderedMiddleware, StickyCookie } from "./middlewares";
import { renderMiddleware, renderStickyCookie } from "./middlewares";
import { getDynamicDir } from "./paths";

/**
 * Container port a router forwards to when the domain row has none. Every
 * writer (deploy engine, router syncs, previews, compose) must use this one
 * constant — the deploy path used 80 while router edits used 3000, so a
 * port-less domain flapped between the two on every edit.
 */
export const DEFAULT_CONTAINER_PORT = 80;

// ─── Public contract types ───────────────────────────────────────────────────

/** One `domain_middleware` row, as handed to the writer. */
export interface TraefikMiddlewareEntry {
	kind: DomainMiddlewareKind;
	config: unknown;
	/** Position in the chain (ascending); ties keep input order. */
	order?: number;
	enabled?: boolean;
}

/** Layer a domain routes on — see the `domain_protocol` pgEnum. */
export type TraefikRouteProtocol = "http" | "tcp" | "udp";

/** TCP TLS handling — see the `domain_tls_mode` pgEnum. */
export type TraefikTlsMode = "none" | "terminate" | "passthrough";

export interface TraefikDomainEntry {
	host: string;
	/** Container port the router forwards to (defaults to {@link DEFAULT_CONTAINER_PORT}). */
	port: number;
	/**
	 * Layer this domain routes on. Omitted/`"http"` keeps the historical
	 * behaviour (`http.routers` on `web`/`websecure`); `"tcp"`/`"udp"` emit
	 * `tcp.`/`udp.` routers on {@link TraefikDomainEntry.entrypoint} and ignore
	 * every HTTP-only field (path, internalPath, middlewares, redirects,
	 * basic-auth, https).
	 */
	protocol?: TraefikRouteProtocol | null;
	/** Named Traefik entrypoint for `tcp`/`udp` rows (`traefik_entrypoint.name`). */
	entrypoint?: string | null;
	/** TCP TLS handling; ignored for `http` and `udp`. */
	tlsMode?: TraefikTlsMode | null;
	path?: string | null;
	/**
	 * Upstream path prefix: the public `path` prefix is stripped and this one
	 * prepended before forwarding (`/public/x` → `/internal/x`).
	 */
	internalPath?: string | null;
	https: boolean;
	certificateType: "letsencrypt" | "none" | "custom";
	/** References a `certificate` row when certificateType is "custom". */
	certificateId?: string | null;
	/** Compose only: route to `<appName>-<serviceName>-1` instead of `<appName>`. */
	serviceName?: string | null;
	/** Stable suffix for router/service names (defaults to the array index). */
	uniqueConfigKey?: string | null;
	/** Per-domain middleware rows, chained after the app-wide ones. */
	middlewares?: TraefikMiddlewareEntry[];
}

export interface TraefikRedirectEntry {
	regex: string;
	replacement: string;
	permanent: boolean;
}

/** Basic-auth row; `password` must already be a bcrypt hash (htpasswd format). */
export interface TraefikBasicAuthEntry {
	username: string;
	password: string;
}

export interface WriteAppTraefikConfigInput {
	appName: string;
	/**
	 * Accepted for contract compatibility and IGNORED: app routing YAML is
	 * always written on the Nixploy host, where `nixploy-traefik` runs (see
	 * {@link writeAppTraefikConfig}).
	 */
	serverId?: string | null;
	domains: TraefikDomainEntry[];
	redirects?: TraefikRedirectEntry[];
	basicAuth?: TraefikBasicAuthEntry[];
}

// ─── Traefik file-provider config shape ─────────────────────────────────────

interface TlsDomain {
	main: string;
	sans?: string[];
}

interface HttpRouter {
	rule: string;
	service: string;
	entryPoints: string[];
	middlewares?: string[];
	tls?: { certResolver?: string; domains?: TlsDomain[] };
}

interface HttpService {
	loadBalancer: {
		servers: Array<{ url: string }>;
		passHostHeader: boolean;
		sticky?: { cookie: StickyCookie };
	};
}

type HttpMiddleware =
	| { redirectScheme: { scheme: string; permanent: boolean } }
	| {
			redirectRegex: { regex: string; replacement: string; permanent: boolean };
	  }
	| { basicAuth: { removeHeader: boolean; users: string[] } }
	| { stripPrefix: { prefixes: string[] } }
	| { addPrefix: { prefix: string } }
	| RenderedMiddleware;

/**
 * A TCP router. Traefik matches TCP only by SNI, so `HostSNI(`*`)` (the
 * catch-all, the only rule allowed without TLS) or `HostSNI(`host`)` are the
 * two shapes Nixploy emits. `tls.passthrough` forwards the encrypted stream
 * untouched; without it Traefik terminates and speaks plaintext upstream.
 */
interface TcpRouter {
	rule: string;
	service: string;
	entryPoints: string[];
	tls?: { passthrough?: boolean; certResolver?: string; domains?: TlsDomain[] };
}

/** Layer-4 services address the backend as `host:port`, not as a URL. */
interface Layer4Service {
	loadBalancer: { servers: Array<{ address: string }> };
}

interface UdpRouter {
	service: string;
	entryPoints: string[];
}

interface FileConfig {
	/**
	 * Omitted entirely for an app with only layer-4 domains: Traefik v3
	 * rejects a file whose `http` section has an empty `routers` map with
	 * "routers cannot be a standalone element" and then drops the WHOLE file —
	 * including the tcp/udp routers that were the point of it.
	 */
	http?: {
		routers: Record<string, HttpRouter>;
		services: Record<string, HttpService>;
		middlewares?: Record<string, HttpMiddleware>;
	};
	tcp?: {
		routers: Record<string, TcpRouter>;
		services: Record<string, Layer4Service>;
	};
	udp?: {
		routers: Record<string, UdpRouter>;
		services: Record<string, Layer4Service>;
	};
	tls?: {
		certificates: Array<{ certFile: string; keyFile: string }>;
	};
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Shell-quote a string for POSIX sh (single-quote wrapping). */
const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Traefik object names must be alphanumeric + dashes. */
const sanitizeName = (value: string): string => value.replace(/[^a-zA-Z0-9-]/g, "-");

/**
 * ACME resolver used for wildcard hosts. Only rendered into the static config
 * when a DNS provider is configured (`web_server_settings.acmeDnsProvider`);
 * `domain.create` refuses a Let's Encrypt wildcard without one, because
 * HTTP-01 can never validate `*.example.com`.
 */
export const DNS_CERT_RESOLVER = "letsencrypt-dns";

/** `*.example.com` — exactly one leading wildcard label. */
export const isWildcardHost = (host: string): boolean => host.trim().startsWith("*.");

/**
 * Traefik entrypoint names are rendered verbatim into both the static config
 * and every `entryPoints:` list, so they are restricted to a lowercase slug.
 * The same expression gates `traefik_entrypoint.name` on write.
 */
export const TRAEFIK_ENTRYPOINT_NAME_RE = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

/** Built-in entrypoints from the static config; a tcp/udp row may not use them. */
export const RESERVED_ENTRYPOINT_NAMES: ReadonlySet<string> = new Set(["web", "websecure"]);

/** Validate an entrypoint name before it reaches YAML. */
export const assertEntrypointName = (name: string): string => {
	const value = name.trim().toLowerCase();
	if (!TRAEFIK_ENTRYPOINT_NAME_RE.test(value)) {
		throw badRequest(
			`Invalid Traefik entrypoint name "${name}": use 2–32 lowercase letters, digits and dashes`,
		);
	}
	if (RESERVED_ENTRYPOINT_NAMES.has(value)) {
		throw badRequest(`Entrypoint name "${value}" is reserved for HTTP routing`);
	}
	return value;
};

/**
 * Traefik v3 dropped the named-group HostRegexp syntax, so a wildcard host
 * becomes a plain Go regexp matching exactly one label — the same span a
 * wildcard certificate covers (`a.example.com` yes, `a.b.example.com` no).
 */
const wildcardHostRule = (baseHost: string): string =>
	`HostRegexp(\`^[a-zA-Z0-9_-]+\\.${baseHost.replace(/[.]/g, "\\.")}$\`)`;

/** Strip backticks and reject Traefik rule metacharacters in Host/Path values. */
const sanitizeRuleValue = (value: string): string => {
	const cleaned = value.replace(/`/g, "").trim();
	if (!cleaned || /[()|\\\n\r]/.test(cleaned)) {
		throw badRequest(`Unsafe Traefik rule value: ${value}`);
	}
	return cleaned;
};

/**
 * Convert an internationalized domain name to ASCII punycode — Traefik
 * requires ASCII hosts (e.g. "тест.рф" → "xn--e1aybc.xn--p1ai").
 */
const toPunycode = (host: string): string => {
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return host;
	}
};

export type AtomicWriteResult = "written" | "unchanged";

/**
 * Write `content` to a local file atomically and idempotently:
 * - identical content → no write at all (`"unchanged"`), so a redeploy of an
 *   unchanged app does not make Traefik's file provider re-parse the whole
 *   dynamic directory;
 * - otherwise the content goes to a `.tmp` sibling (an extension the file
 *   provider ignores) and is `rename`d into place, so a watcher can never
 *   read a truncated YAML.
 */
export const writeLocalFileAtomic = async (
	absolutePath: string,
	content: string,
): Promise<AtomicWriteResult> => {
	await mkdir(dirname(absolutePath), { recursive: true });
	try {
		if ((await readFile(absolutePath, "utf8")) === content) return "unchanged";
	} catch {
		// missing or unreadable — write it
	}
	const tmpPath = `${absolutePath}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
	try {
		// 0600: per-app YAML carries basic-auth bcrypt hashes and inlined TLS
		// private keys (security audit 2.4).
		await writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
		await rename(tmpPath, absolutePath);
	} catch (error) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw error;
	}
	return "written";
};

/**
 * Write a file on the Nixploy host (local fs) or a managed server (SSH).
 * Both paths are atomic (tmp + rename / `mv -f`); the local one also skips
 * unchanged content — see {@link writeLocalFileAtomic}. Remote content goes
 * over stdin, never on argv: certificates carry private keys and basic-auth
 * files carry password hashes, both visible in `ps` (and capped at 128 KiB)
 * when embedded in the command line.
 */
export const writeFileOnServer = async (
	absolutePath: string,
	content: string,
	serverId?: string | null,
): Promise<void> => {
	if (serverId) {
		const tmpPath = `${absolutePath}.tmp`;
		await execAsyncWithStdin(
			`mkdir -p ${shq(dirname(absolutePath))} && (umask 077 && cat > ${shq(tmpPath)}) && ` +
				`chmod 600 ${shq(tmpPath)} && mv -f ${shq(tmpPath)} ${shq(absolutePath)}`,
			content,
			{ serverId },
		);
		return;
	}
	await writeLocalFileAtomic(absolutePath, content);
};

/** Delete a file on the Nixploy host or a managed server. Missing files are OK. */
export const removeFileOnServer = async (
	absolutePath: string,
	serverId?: string | null,
): Promise<void> => {
	if (serverId) {
		await execAsyncRemote(serverId, `rm -f ${shq(absolutePath)}`);
		return;
	}
	await rm(absolutePath, { force: true });
};

// ─── Config generation ───────────────────────────────────────────────────────

/**
 * `redirectRegex.replacement` is written verbatim into the tenant's own
 * Traefik router, so an unvalidated value is an open redirect on a domain the
 * organization controls (security audit 2.6). Allow only:
 *
 * - a relative target (`/somewhere`, `${1}/x`) — same host by construction;
 * - an absolute `https://` target whose host is one of this app's own domains.
 *
 * Capture-group references are preserved, but a replacement that builds its
 * HOST from a capture group is refused: the resulting host is not knowable
 * here, so it cannot be checked against the service's domains.
 */
export function assertSafeRedirectReplacement(
	replacement: string,
	ownHosts: ReadonlySet<string>,
): string {
	const value = replacement.trim();
	if (!value) throw badRequest("Redirect replacement must not be empty");
	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
	if (!scheme) {
		if (value.startsWith("//")) {
			throw badRequest("Redirect replacement must not be protocol-relative");
		}
		return value;
	}
	if (scheme !== "http" && scheme !== "https") {
		throw badRequest("Redirect replacement must be an http(s) URL or a same-host path");
	}
	const host =
		value
			.slice(scheme.length + 3)
			.split(/[/?#]/, 1)[0]
			?.toLowerCase() ?? "";
	if (!host || host.includes("$")) {
		throw badRequest("Redirect replacement must name a literal host");
	}
	const bareHost = host.replace(/:\d+$/, "");
	if (scheme === "https" || ownHosts.has(host) || ownHosts.has(bareHost)) return value;
	throw badRequest(
		`Redirect replacement host "${host}" must be https or one of this service's own domains`,
	);
}

/**
 * Build the Traefik v3 file-provider config for one app, modeled on Dokploy's
 * `manageDomain`/`createRouterConfig`:
 * - one service per domain (`http://<appName>:<port>` load balancer);
 * - one `web` router per domain, plus a `websecure` router (the platform
 *   redirects :80→:443 at the entrypoint, so every domain needs a TLS
 *   router — https-off domains fall back to the self-signed default cert);
 * - redirects / basic-auth / internal-path become named middlewares;
 * - custom certificates are inlined in `tls.certificates` (files previously
 *   written under the dynamic dir by the certificate module).
 */
export const buildTraefikFileConfig = async (
	input: WriteAppTraefikConfigInput,
): Promise<FileConfig> => {
	const { appName, domains: allDomains, redirects = [], basicAuth = [] } = input;

	const http = {
		routers: {} as Record<string, HttpRouter>,
		services: {} as Record<string, HttpService>,
		middlewares: {} as Record<string, HttpMiddleware> | undefined,
	};
	const config: FileConfig = { http };
	const middlewares = http.middlewares as Record<string, HttpMiddleware>;

	// Layer-4 rows share nothing with the HTTP pipeline (no path, no
	// middlewares, no redirect-to-https), so they are split off first and
	// rendered by their own emitter below.
	const domains = allDomains.filter((domain) => (domain.protocol ?? "http") === "http");
	const layer4Domains = allDomains.filter((domain) => (domain.protocol ?? "http") !== "http");

	const usesHttps = domains.some((d) => d.https);
	const redirectToHttpsName = `${sanitizeName(appName)}-redirect-to-https`;
	if (usesHttps) {
		middlewares[redirectToHttpsName] = {
			redirectScheme: { scheme: "https", permanent: true },
		};
	}

	// Shared middlewares referenced by every router of this app.
	const sharedMiddlewareNames: string[] = [];
	const ownHosts = new Set(domains.map((domain) => domain.host.toLowerCase()));
	redirects.forEach((redirect, index) => {
		const name = `redirect-${sanitizeName(appName)}-${index}`;
		middlewares[name] = {
			redirectRegex: {
				regex: redirect.regex,
				replacement: assertSafeRedirectReplacement(redirect.replacement, ownHosts),
				permanent: redirect.permanent,
			},
		};
		sharedMiddlewareNames.push(name);
	});

	if (basicAuth.length > 0) {
		const name = `auth-${sanitizeName(appName)}`;
		middlewares[name] = {
			basicAuth: {
				removeHeader: true,
				users: basicAuth.map((row) => `${row.username}:${row.password}`),
			},
		};
		sharedMiddlewareNames.push(name);
	}

	domains.forEach((domain, index) => {
		const key = sanitizeName(domain.uniqueConfigKey || String(index));
		const routerName = `${sanitizeName(appName)}-router-${key}`;
		const routerNameSecure = `${sanitizeName(appName)}-router-websecure-${key}`;
		const serviceName = `${sanitizeName(appName)}-service-${key}`;

		const rawHost = sanitizeRuleValue(domain.host);
		// A wildcard is only ever the leading label: `Host(`*`)` or an inner `*`
		// would catch unrelated traffic. Everything after `*.` is validated as a
		// normal host, so `*.*.evil` and `*evil.com` are still rejected.
		const wildcard = isWildcardHost(rawHost);
		const host = sanitizeRuleValue(toPunycode(wildcard ? rawHost.slice(2) : rawHost));
		if (host.includes("*") || !/^[a-zA-Z0-9.-]+(\.[a-zA-Z0-9.-]+)*\.?$/.test(host)) {
			throw badRequest(`Invalid Traefik host after punycode: ${domain.host}`);
		}
		// `*.com` would ask a public-suffix-wide certificate; require a zone.
		if (wildcard && host.split(".").filter(Boolean).length < 2) {
			throw badRequest(`Wildcard host needs a parent domain: ${domain.host}`);
		}
		const matchHost = wildcard ? `*.${host}` : host;
		const path = domain.path && domain.path !== "/" ? sanitizeRuleValue(domain.path) : null;
		if (path && (!path.startsWith("/") || /[()|`]/.test(path) || path.includes(".."))) {
			throw badRequest(`Invalid Traefik path: ${domain.path}`);
		}
		const hostRule = wildcard ? wildcardHostRule(host) : `Host(\`${host}\`)`;
		const rule = `${hostRule}${path ? ` && PathPrefix(\`${path}\`)` : ""}`;

		if (domain.serviceName && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(domain.serviceName)) {
			throw badRequest(`Invalid compose service name: ${domain.serviceName}`);
		}
		const target = domain.serviceName ? `${appName}-${domain.serviceName}-1` : appName;
		const service: HttpService = {
			loadBalancer: {
				servers: [{ url: `http://${target}:${domain.port ?? DEFAULT_CONTAINER_PORT}` }],
				passHostHeader: true,
			},
		};
		http.services[serviceName] = service;

		// Per-domain internal-path rewrite: public `<path>/*` → upstream
		// `<internalPath>/*`. addPrefix alone would yield `/internal/public/*`,
		// so the public prefix is stripped first (Traefik applies middlewares
		// in list order).
		const domainMiddlewares = [...sharedMiddlewareNames];
		if (domain.internalPath && domain.internalPath !== "/" && domain.internalPath !== domain.path) {
			const internalPath = sanitizeRuleValue(domain.internalPath);
			if (!internalPath.startsWith("/") || internalPath.includes("..")) {
				throw badRequest(`Invalid Traefik internal path: ${domain.internalPath}`);
			}
			const addName = `addprefix-${sanitizeName(appName)}-${key}`;
			middlewares[addName] = { addPrefix: { prefix: internalPath } };
			const rewrite = [addName];
			if (path) {
				const stripName = `strip-${sanitizeName(appName)}-${key}`;
				middlewares[stripName] = { stripPrefix: { prefixes: [path] } };
				rewrite.unshift(stripName);
			}
			// The rewrite runs before redirects/auth so upstream sees the real path.
			domainMiddlewares.unshift(...rewrite);
		}

		// Per-domain middleware rows, chained after the app-wide redirect /
		// basic-auth ones and in `order`. Every config is re-validated here, so
		// a row written under looser rules can never reach the YAML.
		const rows = (domain.middlewares ?? [])
			.map((row, position) => ({ row, position }))
			.filter(({ row }) => row.enabled !== false)
			.sort((a, b) => (a.row.order ?? 0) - (b.row.order ?? 0) || a.position - b.position);
		for (const [index, { row }] of rows.entries()) {
			const rendered = renderMiddleware(row.kind, row.config);
			if (!rendered) {
				// stickyCookie is a load-balancer option, not a middleware.
				service.loadBalancer.sticky = { cookie: renderStickyCookie(row.config) };
				continue;
			}
			const name = `mw-${sanitizeName(appName)}-${key}-${index}-${sanitizeName(row.kind)}`;
			middlewares[name] = rendered;
			domainMiddlewares.push(name);
		}

		if (domain.https) {
			// Plain-HTTP router only bounces to https; everything else happens
			// on the websecure router where the request actually lands.
			http.routers[routerName] = {
				rule,
				service: serviceName,
				entryPoints: ["web"],
				middlewares: [redirectToHttpsName],
			};

			const secureRouter: HttpRouter = {
				rule,
				service: serviceName,
				entryPoints: ["websecure"],
				middlewares: domainMiddlewares,
			};
			if (domain.certificateType === "letsencrypt") {
				// A wildcard can only be validated by DNS-01, and Traefik needs
				// `tls.domains` to know which SAN to ask for (the router rule is a
				// regexp, so it cannot derive the name from the request).
				secureRouter.tls = wildcard
					? { certResolver: DNS_CERT_RESOLVER, domains: [{ main: matchHost }] }
					: { certResolver: "letsencrypt" };
			} else {
				// "custom": the cert comes from tls.certificates below.
				// "none": Traefik serves the default (self-signed) certificate.
				// Either way the router MUST declare `tls`, otherwise Traefik only
				// matches it for plain HTTP and the priority-1 dashboard catch-all
				// (which does declare tls) swallows every HTTPS request → 502.
				secureRouter.tls = {};
			}
			http.routers[routerNameSecure] = secureRouter;
		} else {
			http.routers[routerName] = {
				rule,
				service: serviceName,
				entryPoints: ["web"],
				middlewares: domainMiddlewares,
			};
			// The platform redirects :80→:443 globally, so an https-off domain
			// still needs a websecure router; it serves the default cert.
			http.routers[routerNameSecure] = {
				rule,
				service: serviceName,
				entryPoints: ["websecure"],
				middlewares: domainMiddlewares,
				tls: {},
			};
		}
	});

	if (Object.keys(middlewares).length === 0) {
		http.middlewares = undefined;
		delete (http as { middlewares?: unknown }).middlewares;
	}

	// ── layer-4 (tcp / udp) ───────────────────────────────────────────────
	//
	// TCP can only be matched by SNI, so a router either claims the whole
	// entrypoint (`HostSNI(`*`)`, the only rule Traefik accepts on a
	// non-TLS TCP router) or one hostname when TLS is terminated/passed
	// through. UDP is connectionless: no rule at all, the entrypoint IS the
	// match, so one UDP router per entrypoint is all that can ever work.
	const tcpRouters: Record<string, TcpRouter> = {};
	const tcpServices: Record<string, Layer4Service> = {};
	const udpRouters: Record<string, UdpRouter> = {};
	const udpServices: Record<string, Layer4Service> = {};
	layer4Domains.forEach((domain, index) => {
		const key = sanitizeName(domain.uniqueConfigKey || `l4-${index}`);
		const protocol = domain.protocol === "udp" ? "udp" : "tcp";
		const entrypoint = assertEntrypointName(domain.entrypoint ?? "");
		if (domain.serviceName && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(domain.serviceName)) {
			throw badRequest(`Invalid compose service name: ${domain.serviceName}`);
		}
		const target = domain.serviceName ? `${appName}-${domain.serviceName}-1` : appName;
		const serviceName = `${sanitizeName(appName)}-${protocol}-service-${key}`;
		const routerName = `${sanitizeName(appName)}-${protocol}-router-${key}`;
		const service: Layer4Service = {
			loadBalancer: {
				servers: [{ address: `${target}:${domain.port ?? DEFAULT_CONTAINER_PORT}` }],
			},
		};

		if (protocol === "udp") {
			udpServices[serviceName] = service;
			udpRouters[routerName] = { service: serviceName, entryPoints: [entrypoint] };
			return;
		}

		tcpServices[serviceName] = service;
		const tlsMode = domain.tlsMode ?? "none";
		const router: TcpRouter = {
			// A plain TCP router cannot read a hostname: with no TLS the only
			// legal rule is the catch-all, and the entrypoint's port is what
			// distinguishes services.
			rule: "HostSNI(`*`)",
			service: serviceName,
			entryPoints: [entrypoint],
		};
		if (tlsMode !== "none") {
			const rawHost = sanitizeRuleValue(domain.host);
			const wildcard = isWildcardHost(rawHost);
			const host = sanitizeRuleValue(toPunycode(wildcard ? rawHost.slice(2) : rawHost));
			if (host.includes("*") || !/^[a-zA-Z0-9.-]+(\.[a-zA-Z0-9.-]+)*\.?$/.test(host)) {
				throw badRequest(`Invalid Traefik host after punycode: ${domain.host}`);
			}
			const matchHost = wildcard ? `*.${host}` : host;
			router.rule = `HostSNI(\`${matchHost}\`)`;
			if (tlsMode === "passthrough") {
				// The backend owns the certificate; Traefik never sees plaintext,
				// so a certResolver here would be issued and never used.
				router.tls = { passthrough: true };
			} else if (domain.certificateType === "letsencrypt") {
				router.tls = wildcard
					? { certResolver: DNS_CERT_RESOLVER, domains: [{ main: matchHost }] }
					: { certResolver: "letsencrypt" };
			} else {
				// "custom" certs are inlined in tls.certificates below; "none"
				// serves the self-signed default certificate.
				router.tls = {};
			}
		}
		tcpRouters[routerName] = router;
	});

	// An `http:` section whose `routers` map is empty makes Traefik v3 reject
	// the entire file ("routers cannot be a standalone element"), taking the
	// tcp/udp routers down with it — so an app with only layer-4 domains gets
	// no `http:` key at all.
	if (Object.keys(http.routers).length === 0) {
		delete config.http;
	}

	// Only emitted when there is something to route: an empty `tcp:` block
	// makes Traefik log a warning on every reload.
	if (Object.keys(tcpRouters).length > 0) {
		config.tcp = { routers: tcpRouters, services: tcpServices };
	}
	if (Object.keys(udpRouters).length > 0) {
		config.udp = { routers: udpRouters, services: udpServices };
	}

	// Inline custom certificates referenced by the domains (http and tcp).
	const certificateIds = [
		...new Set(
			allDomains
				.filter((d) => d.certificateType === "custom" && d.certificateId)
				.map((d) => d.certificateId as string),
		),
	];
	if (certificateIds.length > 0) {
		const rows = await db
			.select()
			.from(certificates)
			.where(inArray(certificates.certificateId, certificateIds));
		if (rows.length > 0) {
			config.tls = {
				certificates: rows.map((row) => ({
					certFile: row.certificatePath,
					keyFile: row.certificatePath.replace(/\.crt$/, ".key"),
				})),
			};
		}
	}

	return config;
};

/**
 * The `domain` columns the writer consumes, so a call site can hand a raw
 * Drizzle row to {@link toTraefikDomainEntry} instead of spelling the mapping
 * out. Adding a routing column means adding it here once — the previous
 * per-call-site object literals silently dropped every new field (that is how
 * a deploy used to erase a domain's middleware chain).
 */
export interface TraefikDomainRow {
	host: string;
	port: number | null;
	path: string | null;
	internalPath: string | null;
	https: boolean;
	certificateType: "letsencrypt" | "none" | "custom";
	certificateId: string | null;
	serviceName?: string | null;
	uniqueConfigKey?: string | null;
	protocol?: TraefikRouteProtocol | null;
	entrypoint?: string | null;
	tlsMode?: TraefikTlsMode | null;
	middlewares?: TraefikMiddlewareEntry[];
}

/** Map one `domain` row onto the writer's input shape. */
export const toTraefikDomainEntry = (row: TraefikDomainRow): TraefikDomainEntry => ({
	host: row.host,
	port: row.port ?? DEFAULT_CONTAINER_PORT,
	path: row.path,
	internalPath: row.internalPath,
	https: row.https,
	certificateType: row.certificateType,
	certificateId: row.certificateId,
	serviceName: row.serviceName ?? null,
	uniqueConfigKey: row.uniqueConfigKey ?? null,
	protocol: row.protocol ?? "http",
	entrypoint: row.entrypoint ?? null,
	tlsMode: row.tlsMode ?? "none",
	middlewares: row.middlewares,
});

// ─── Contract functions ──────────────────────────────────────────────────────

/**
 * (Re)generate `<configDir>/traefik/dynamic/<appName>.yml` from scratch.
 * Traefik's file provider watches the directory and hot-reloads. With no
 * domains the config file is removed instead.
 *
 * ALWAYS written on the Nixploy host, whatever server the app runs on:
 * `nixploy-traefik` is a manager-constrained service on the primary node
 * and its file provider only sees the local dynamic dir, while the
 * `http://<appName>:<port>` upstream resolves cluster-wide through the
 * overlay network's VIP DNS. Writing the YAML onto a managed server (the
 * previous behaviour when `serverId` was set) produced a file nothing ever
 * read, and the domain fell through to the dashboard catch-all.
 */
export const writeAppTraefikConfig = async (input: WriteAppTraefikConfigInput): Promise<void> => {
	if (input.domains.length === 0) {
		await removeTraefikConfig(input.appName);
		return;
	}
	const config = await buildTraefikFileConfig(input);
	const yamlStr = stringify(config);
	const configPath = `${getDynamicDir()}/${input.appName}.yml`;
	// Atomic and idempotent: a deploy storm of unchanged apps is not a
	// Traefik reload storm, and the watcher never sees a half-written file.
	await writeLocalFileAtomic(configPath, yamlStr);
};

/**
 * Delete an app's dynamic config file (all its routes disappear). `serverId`
 * is accepted for contract compatibility and ignored — see
 * {@link writeAppTraefikConfig}.
 */
export const removeTraefikConfig = async (
	appName: string,
	_serverId?: string | null,
): Promise<void> => {
	const configPath = `${getDynamicDir()}/${appName}.yml`;
	await removeFileOnServer(configPath, null);
};
