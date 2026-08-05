import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inArray } from "drizzle-orm";
import { stringify } from "yaml";
import { db } from "../../db";
import { certificates } from "../../db/schema";
import { execAsyncRemote } from "../../utils/exec";
import { getDynamicDir } from "./paths";

// ─── Public contract types ───────────────────────────────────────────────────

export interface TraefikDomainEntry {
	host: string;
	/** Container port the router forwards to (defaults to 80). */
	port: number;
	path?: string | null;
	/** Internal path prefix prepended to the request before forwarding. */
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
	/** null/undefined = the Nixploy host itself; otherwise a managed server. */
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
	| { redirectRegex: { regex: string; replacement: string; permanent: boolean } }
	| { basicAuth: { removeHeader: boolean; users: string[] } }
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

/** Strip backticks so a malicious host/path can't break out of the rule. */
const sanitizeRuleValue = (value: string): string => value.replace(/`/g, "");

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

/** Write a file on the Nixploy host (local fs) or a managed server (SSH). */
export const writeFileOnServer = async (
	absolutePath: string,
	content: string,
	serverId?: string | null,
): Promise<void> => {
	if (serverId) {
		const encoded = Buffer.from(content, "utf8").toString("base64");
		await execAsyncRemote(
			serverId,
			`mkdir -p ${shq(dirname(absolutePath))} && echo ${shq(encoded)} | base64 -d > ${shq(absolutePath)}`,
		);
		return;
	}
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content, "utf8");
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
 * - one `web` router per domain, plus a `websecure` router when https;
 * - http→https is a per-router `redirectScheme` middleware (never global, so
 *   plain-HTTP domains keep working);
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
		const path = domain.path && domain.path !== "/" ? sanitizeRuleValue(domain.path) : null;
		const rule = `Host(\`${host}\`)${path ? ` && PathPrefix(\`${path}\`)` : ""}`;

		const target = domain.serviceName ? `${appName}-${domain.serviceName}-1` : appName;
		config.http.services[serviceName] = {
			loadBalancer: {
				servers: [{ url: `http://${target}:${domain.port ?? 80}` }],
				passHostHeader: true,
			},
		};

		// Per-domain internal-path middleware: /public/* → /internal/* upstream.
		const domainMiddlewares = [...sharedMiddlewareNames];
		if (domain.internalPath && domain.internalPath !== "/" && domain.internalPath !== domain.path) {
			const name = `addprefix-${sanitizeName(appName)}-${key}`;
			middlewares[name] = { addPrefix: { prefix: domain.internalPath } };
			// addPrefix runs before redirects/auth so upstream sees the real path.
			domainMiddlewares.unshift(name);
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
			} else if (domain.certificateType === "custom") {
				// TLS without a resolver: the cert comes from tls.certificates below.
				secureRouter.tls = {};
			}
			// certificateType "none" with https: TLS on websecure via default cert.
			config.http.routers[routerNameSecure] = secureRouter;
		} else {
			config.http.routers[routerName] = {
				rule,
				service: serviceName,
				entryPoints: ["web"],
				middlewares: domainMiddlewares,
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
 * (Re)generate `<configDir>/traefik/dynamic/<appName>.yml` from scratch —
 * locally or over SSH. Traefik's file provider watches the directory and
 * hot-reloads. With no domains the config file is removed instead.
 */
export const writeAppTraefikConfig = async (input: WriteAppTraefikConfigInput): Promise<void> => {
	if (input.domains.length === 0) {
		await removeTraefikConfig(input.appName, input.serverId);
		return;
	}
	const config = await buildTraefikFileConfig(input);
	const yamlStr = stringify(config);
	const configPath = `${getDynamicDir()}/${input.appName}.yml`;
	await writeFileOnServer(configPath, yamlStr, input.serverId);
};

/** Delete an app's dynamic config file (all its routes disappear). */
export const removeTraefikConfig = async (
	appName: string,
	serverId?: string | null,
): Promise<void> => {
	const configPath = `${getDynamicDir()}/${appName}.yml`;
	await removeFileOnServer(configPath, serverId);
};
