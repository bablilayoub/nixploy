import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inArray } from "drizzle-orm";
import { stringify } from "yaml";
import { db } from "../../db";
import { certificates } from "../../db/schema";
import { execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { badRequest } from "../errors";
import { getDynamicDir } from "./paths";

/**
 * Container port a router forwards to when the domain row has none. Every
 * writer (deploy engine, router syncs, previews, compose) must use this one
 * constant — the deploy path used 80 while router edits used 3000, so a
 * port-less domain flapped between the two on every edit.
 */
export const DEFAULT_CONTAINER_PORT = 80;

// ─── Public contract types ───────────────────────────────────────────────────

export interface TraefikDomainEntry {
	host: string;
	/** Container port the router forwards to (defaults to {@link DEFAULT_CONTAINER_PORT}). */
	port: number;
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

interface HttpRouter {
	rule: string;
	service: string;
	entryPoints: string[];
	middlewares?: string[];
	tls?: { certResolver?: string };
}

interface HttpService {
	loadBalancer: {
		servers: Array<{ url: string }>;
		passHostHeader: boolean;
	};
}

type HttpMiddleware =
	| { redirectScheme: { scheme: string; permanent: boolean } }
	| {
			redirectRegex: { regex: string; replacement: string; permanent: boolean };
	  }
	| { basicAuth: { removeHeader: boolean; users: string[] } }
	| { stripPrefix: { prefixes: string[] } }
	| { addPrefix: { prefix: string } };

interface FileConfig {
	http: {
		routers: Record<string, HttpRouter>;
		services: Record<string, HttpService>;
		middlewares?: Record<string, HttpMiddleware>;
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
		await writeFile(tmpPath, content, "utf8");
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
			`mkdir -p ${shq(dirname(absolutePath))} && cat > ${shq(tmpPath)} && mv -f ${shq(tmpPath)} ${shq(absolutePath)}`,
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
	const { appName, domains, redirects = [], basicAuth = [] } = input;

	const config: FileConfig = {
		http: { routers: {}, services: {}, middlewares: {} },
	};
	const middlewares = config.http.middlewares as Record<string, HttpMiddleware>;

	const usesHttps = domains.some((d) => d.https);
	const redirectToHttpsName = `${sanitizeName(appName)}-redirect-to-https`;
	if (usesHttps) {
		middlewares[redirectToHttpsName] = {
			redirectScheme: { scheme: "https", permanent: true },
		};
	}

	// Shared middlewares referenced by every router of this app.
	const sharedMiddlewareNames: string[] = [];
	redirects.forEach((redirect, index) => {
		const name = `redirect-${sanitizeName(appName)}-${index}`;
		middlewares[name] = {
			redirectRegex: {
				regex: redirect.regex,
				replacement: redirect.replacement,
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

		const host = sanitizeRuleValue(toPunycode(domain.host));
		// No wildcards — a Host(`*`) / Host(`*.evil`) rule would catch unrelated traffic.
		if (host.includes("*") || !/^[a-zA-Z0-9.-]+(\.[a-zA-Z0-9.-]+)*\.?$/.test(host)) {
			throw badRequest(`Invalid Traefik host after punycode: ${domain.host}`);
		}
		const path = domain.path && domain.path !== "/" ? sanitizeRuleValue(domain.path) : null;
		if (path && (!path.startsWith("/") || /[()|`]/.test(path) || path.includes(".."))) {
			throw badRequest(`Invalid Traefik path: ${domain.path}`);
		}
		const rule = `Host(\`${host}\`)${path ? ` && PathPrefix(\`${path}\`)` : ""}`;

		if (domain.serviceName && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(domain.serviceName)) {
			throw badRequest(`Invalid compose service name: ${domain.serviceName}`);
		}
		const target = domain.serviceName ? `${appName}-${domain.serviceName}-1` : appName;
		config.http.services[serviceName] = {
			loadBalancer: {
				servers: [{ url: `http://${target}:${domain.port ?? DEFAULT_CONTAINER_PORT}` }],
				passHostHeader: true,
			},
		};

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

		if (domain.https) {
			// Plain-HTTP router only bounces to https; everything else happens
			// on the websecure router where the request actually lands.
			config.http.routers[routerName] = {
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
				secureRouter.tls = { certResolver: "letsencrypt" };
			} else {
				// "custom": the cert comes from tls.certificates below.
				// "none": Traefik serves the default (self-signed) certificate.
				// Either way the router MUST declare `tls`, otherwise Traefik only
				// matches it for plain HTTP and the priority-1 dashboard catch-all
				// (which does declare tls) swallows every HTTPS request → 502.
				secureRouter.tls = {};
			}
			config.http.routers[routerNameSecure] = secureRouter;
		} else {
			config.http.routers[routerName] = {
				rule,
				service: serviceName,
				entryPoints: ["web"],
				middlewares: domainMiddlewares,
			};
			// The platform redirects :80→:443 globally, so an https-off domain
			// still needs a websecure router; it serves the default cert.
			config.http.routers[routerNameSecure] = {
				rule,
				service: serviceName,
				entryPoints: ["websecure"],
				middlewares: domainMiddlewares,
				tls: {},
			};
		}
	});

	if (Object.keys(middlewares).length === 0) {
		delete config.http.middlewares;
	}

	// Inline custom certificates referenced by the domains.
	const certificateIds = [
		...new Set(
			domains
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
