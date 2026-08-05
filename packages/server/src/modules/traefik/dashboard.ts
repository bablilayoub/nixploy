import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { writeFileOnServer } from "./config-writer";
import { getDynamicDir, REMOTE_TRAEFIK_DIR, TRAEFIK_DYNAMIC_CONTAINER_DIR } from "./paths";

/** Dynamic-config file that routes the Nixploy dashboard itself. */
export const DASHBOARD_CONFIG_FILE = "00-nixploy-dashboard.yml";
/** Dynamic-config file holding the self-signed default certificate. */
export const DEFAULT_TLS_CONFIG_FILE = "00-default-tls.yml";

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
 * - a priority-1 catch-all on `websecure` so `https://<server-ip>` reaches
 *   the dashboard with the self-signed default certificate;
 * - when a domain is configured, a `Host()` router with the Let's Encrypt
 *   resolver — the certificate is issued on the first request.
 *
 * `target` differs between production (swarm service name `nixploy`) and
 * local dev (host networking); callers pass the right one.
 */
export const buildDashboardRouterYaml = (domain: string | null, target: string): string => {
	const domainRouter = domain
		? `    nixploy-dashboard-domain:
      rule: Host(\`${domain}\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      tls:
        certResolver: letsencrypt
`
		: "";
	return `http:
  routers:
    nixploy-dashboard:
      rule: PathPrefix(\`/\`)
      entryPoints:
        - websecure
      service: nixploy-dashboard
      tls: {}
      priority: 1
${domainRouter}  services:
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
	// overlay network with it.
	const target = "http://nixploy:3000";
	await writeFileOnServer(
		`${dynamicDir}/${DASHBOARD_CONFIG_FILE}`,
		buildDashboardRouterYaml(domain, target),
		serverId,
	);
};
