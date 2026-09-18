import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { writeFileOnServer } from "./config-writer";
import { panelInternalUrl } from "./middlewares";
import { getDynamicDir, REMOTE_TRAEFIK_DIR, TRAEFIK_DYNAMIC_CONTAINER_DIR } from "./paths";

/** Dynamic-config file that routes the Nixploy dashboard itself. */
export const DASHBOARD_CONFIG_FILE = "00-nixploy-dashboard.yml";
/** Dynamic-config file holding the self-signed default certificate. */
export const DEFAULT_TLS_CONFIG_FILE = "00-default-tls.yml";

/**
 * HSTS for the panel only. Tenant routers never get it: a tenant may serve
 * plain HTTP on purpose and the panel must not pin someone else's domain.
 * No `includeSubdomains` / `preload` — tenant hosts are often subdomains of
 * the panel's domain and must keep their own policy.
 */
export const DASHBOARD_HEADERS_MIDDLEWARE = "nixploy-dashboard-headers";
export const DASHBOARD_HSTS_SECONDS = 31_536_000;

/**
 * There is deliberately NO `buffering` middleware in front of the panel.
 *
 * It used to cap request bodies at 4 MiB on `/api/`, but Traefik's buffering
 * middleware buffers the *response* too, and oxy fails with
 * `failed to read response, err: no data ready` whenever the backend answers
 * with an EMPTY body — Traefik then returns its own `500 Internal Server
 * Error`. Every bodyless response was affected: the GitHub App callback's
 * 307 redirect, `204`s, empty `404`s (observed on a live install, 2026-09-14;
 * `/api/version` and `/api/ready` passed because they carry JSON).
 *
 * Request size is capped by the app instead — the REST adapter refuses a
 * `content-length` over 1 MiB and the webhook routes cap their own payloads —
 * so the backstop is not worth a proxy that mangles ordinary responses.
 */

const isValidDomain = (value: string): boolean =>
	/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(value);

/** Normalize user input ("https://panel.example.com/x" → "panel.example.com"). */
export const normalizeDashboardDomain = (raw: string | null | undefined): string | null => {
	if (!raw) return null;
	let host = raw.trim().toLowerCase();
	host = host.replace(/^https?:\/\//, "");
	host = host.split("/")[0] ?? "";
	host = host.split(":")[0] ?? "";
	if (!host || !isValidDomain(host)) return null;
	return host;
};

/**
 * YAML for the dashboard routing file:
 * - when **no** domain is configured, a priority-1 catch-all on `websecure` so
 *   `https://<server-ip>` reaches the dashboard with the self-signed default
 *   certificate;
 * - when a domain **is** configured, the same router scoped to `Host(<domain>)`
 *   with the Let's Encrypt resolver — the certificate is issued on the first
 *   request — and the catch-all is dropped: it answered on every hostname
 *   pointed at the box (bare IP, stray DNS), which fingerprinted the panel on
 *   vhosts nobody configured (audit security.md §2.10). Tenant domains are
 *   unaffected either way; they always carry their own `Host()` routers.
 *
 * Every dashboard router carries the HSTS middleware; tenant routers
 * (`config-writer.ts`) never reference these middlewares.
 *
 * `target` differs between production (swarm service name `nixploy`) and
 * local dev (host networking); callers pass the right one.
 */
export const buildDashboardRouterYaml = (domain: string | null, target: string): string => {
	const catchAllRouters = domain
		? ""
		: `    nixploy-dashboard:
      rule: PathPrefix(\`/\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      middlewares:
        - ${DASHBOARD_HEADERS_MIDDLEWARE}
      tls: {}
      priority: 1
`;
	const domainRouters = domain
		? `    nixploy-dashboard-domain:
      rule: Host(\`${domain}\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      middlewares:
        - ${DASHBOARD_HEADERS_MIDDLEWARE}
      tls:
        certResolver: letsencrypt
`
		: "";
	return `http:
  routers:
${catchAllRouters}${domainRouters}  middlewares:
    ${DASHBOARD_HEADERS_MIDDLEWARE}:
      headers:
        stsSeconds: ${DASHBOARD_HSTS_SECONDS}
        stsIncludeSubdomains: false
        stsPreload: false
  services:
    nixploy-dashboard:
      loadBalancer:
        servers:
          - url: ${target}
`;
};

export const buildDefaultTlsYaml = (): string => `tls:
  stores:
    default:
      defaultCertificate:
        certFile: ${TRAEFIK_DYNAMIC_CONTAINER_DIR}/default.crt
        keyFile: ${TRAEFIK_DYNAMIC_CONTAINER_DIR}/default.key
`;

/**
 * The dashboard domain persisted in web-server settings, falling back to the
 * install-time domain (BETTER_AUTH_URL) when nothing was configured in the
 * UI yet — so `NIXPLOY_DOMAIN=… install.sh` installs keep their routing when
 * settings are saved later.
 */
export const getDashboardDomain = async (): Promise<string | null> => {
	const [row] = await db.select().from(webServerSettings).limit(1);
	const fromDb = normalizeDashboardDomain(row?.host);
	if (fromDb) return fromDb;
	const envUrl = process.env.BETTER_AUTH_URL;
	if (envUrl) {
		try {
			const host = new URL(envUrl).hostname;
			if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host !== "localhost") {
				return normalizeDashboardDomain(host);
			}
		} catch {
			// Malformed env URL — treat as unset.
		}
	}
	return null;
};

/**
 * (Re)write the dashboard routing file. Traefik's file provider hot-reloads,
 * so the domain goes live without a proxy restart.
 */
export const writeDashboardRouterConfig = async (
	domain: string | null,
	serverId?: string | null,
): Promise<void> => {
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();
	// In the swarm the app is reachable by service name; Traefik shares the
	// overlay network with it. `NIXPLOY_PANEL_INTERNAL_URL` overrides that for
	// a local checkout, where the panel runs on the host.
	const target = panelInternalUrl();
	await writeFileOnServer(
		`${dynamicDir}/${DASHBOARD_CONFIG_FILE}`,
		buildDashboardRouterYaml(domain, target),
		serverId,
	);
};
