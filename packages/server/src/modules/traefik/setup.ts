import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { writeFileOnServer } from "./config-writer";
import {
	buildDefaultTlsYaml,
	DEFAULT_TLS_CONFIG_FILE,
	getDashboardDomain,
	writeDashboardRouterConfig,
} from "./dashboard";
import {
	getDynamicDir,
	getTraefikDir,
	REMOTE_TRAEFIK_DIR,
	TRAEFIK_ACME_CONTAINER_PATH,
	TRAEFIK_DYNAMIC_CONTAINER_DIR,
} from "./paths";

/** Swarm service name of the platform reverse proxy. */
export const TRAEFIK_SERVICE_NAME = "nixploy-traefik";
/** Pinned Traefik image (v3, file provider). */
export const TRAEFIK_IMAGE = "traefik:v3.5.0";

const getSwarmNetwork = (): string => process.env.NIXPLOY_NETWORK ?? "nixploy-network";

/** Shell-quote a string for POSIX sh (single-quote wrapping). */
const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Run a shell command on the Nixploy host or a managed server. */
const runOn = (serverId: string | null | undefined, command: string): Promise<string> =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

/**
 * Traefik v3 static configuration. The file provider watches the dynamic
 * directory (hot-reload). HTTP is redirected to HTTPS globally; ACME uses
 * the HTTP challenge on `web` (Traefik serves challenges before redirect).
 * TLS for bare IPs uses the self-signed defaultCertificate; app domains
 * attach `certResolver: letsencrypt` per-router in dynamic YAML.
 */
export const buildTraefikStaticConfig = (letsEncryptEmail?: string | null): string => {
	const email = letsEncryptEmail?.trim() || "nixploy@localhost";
	return `global:
  checkNewVersion: false
  sendAnonymousUsage: false
log:
  level: ERROR
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"
providers:
  file:
    directory: ${TRAEFIK_DYNAMIC_CONTAINER_DIR}
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: ${TRAEFIK_ACME_CONTAINER_PATH}
      httpChallenge:
        entryPoint: web
api:
  dashboard: false
`;
};

const getLetsEncryptEmail = async (): Promise<string | null> => {
	const [settings] = await db.select().from(webServerSettings).limit(1);
	return settings?.letsEncryptEmail ?? null;
};

/**
 * Self-signed default cert + dashboard routing (catch-all for bare-IP HTTPS
 * plus the configured domain, if any). The cert is generated only when
 * missing; the YAML files are always refreshed.
 */
const ensureDefaultTlsAndDashboard = async (serverId?: string | null): Promise<void> => {
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();
	const certPath = `${dynamicDir}/default.crt`;
	const keyPath = `${dynamicDir}/default.key`;

	await runOn(
		serverId,
		[
			`mkdir -p ${shq(dynamicDir)}`,
			`if [ ! -f ${shq(certPath)} ] || [ ! -f ${shq(keyPath)} ]; then`,
			`  IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"`,
			`  IP="\${IP:-127.0.0.1}"`,
			`  SAN="DNS:localhost,IP:127.0.0.1,IP:\${IP}"`,
			`  if openssl req -x509 -newkey rsa:2048 -nodes -days 825`,
			`      -keyout ${shq(keyPath)} -out ${shq(certPath)}`,
			`      -subj "/CN=nixploy" -addext "subjectAltName=\${SAN}" 2>/dev/null; then`,
			`    true`,
			`  else`,
			`    openssl req -x509 -newkey rsa:2048 -nodes -days 825`,
			`      -keyout ${shq(keyPath)} -out ${shq(certPath)}`,
			`      -subj "/CN=nixploy"`,
			`  fi`,
			`  chmod 600 ${shq(keyPath)} ${shq(certPath)}`,
			`fi`,
		].join("\n"),
	);

	await writeFileOnServer(
		`${dynamicDir}/${DEFAULT_TLS_CONFIG_FILE}`,
		buildDefaultTlsYaml(),
		serverId,
	);
	await writeDashboardRouterConfig(await getDashboardDomain(), serverId);
};

/**
 * Idempotently ensure a working Traefik v3 reverse proxy on the Nixploy
 * host (or, with `serverId`, on a managed server over SSH):
 * 1. write the static `traefik.yml` (always refreshed — email may change);
 * 2. create the dynamic dir + a `chmod 600` acme.json;
 * 3. ensure self-signed default TLS + dashboard catch-all router;
 * 4. create the shared overlay network if missing;
 * 5. create the global `nixploy-traefik` swarm service if missing.
 *
 * Swarm itself must already be active (install.sh / cluster setupServer).
 */
export const ensureTraefikSetup = async (serverId?: string | null): Promise<void> => {
	const traefikDir = serverId ? REMOTE_TRAEFIK_DIR : getTraefikDir();
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();
	const acmePath = `${traefikDir}/acme.json`;
	const network = getSwarmNetwork();

	// 1. Static config (rewritten every call so settings changes take effect).
	const staticConfig = buildTraefikStaticConfig(await getLetsEncryptEmail());
	await writeFileOnServer(`${traefikDir}/traefik.yml`, staticConfig, serverId);

	// 2. Dynamic dir + ACME storage (must exist with tight perms before mount).
	await runOn(
		serverId,
		`mkdir -p ${shq(dynamicDir)} && touch ${shq(acmePath)} && chmod 600 ${shq(acmePath)}`,
	);

	// 3. Self-signed default cert + dashboard route (bare-IP HTTPS).
	await ensureDefaultTlsAndDashboard(serverId);

	// 4. Shared attachable overlay network for service discovery.
	await runOn(
		serverId,
		`if [ -z "$(docker network ls --filter name=^${network}$ --format '{{.Name}}')" ]; then docker network create --driver overlay --attachable ${network}; fi`,
	);

	// 5. The proxy service itself — created once, then left alone. `service ls`
	// filters names by prefix and rejects regex anchors, so the exact match is
	// done here instead of in the filter.
	const existing = await runOn(
		serverId,
		`docker service ls --filter name=${TRAEFIK_SERVICE_NAME} --format '{{.Name}}'`,
	);
	if (
		existing
			.split("\n")
			.map((name) => name.trim())
			.includes(TRAEFIK_SERVICE_NAME)
	) {
		return;
	}

	await runOn(
		serverId,
		[
			"docker service create",
			`--name ${TRAEFIK_SERVICE_NAME}`,
			"--mode global",
			"--constraint node.role==manager",
			`--network ${network}`,
			"--publish mode=host,target=80,published=80",
			"--publish mode=host,target=443,published=443",
			`--mount type=bind,source=${traefikDir}/traefik.yml,destination=/etc/traefik/traefik.yml,readonly`,
			`--mount type=bind,source=${dynamicDir},destination=${TRAEFIK_DYNAMIC_CONTAINER_DIR}`,
			`--mount type=bind,source=${acmePath},destination=${TRAEFIK_ACME_CONTAINER_PATH}`,
			TRAEFIK_IMAGE,
		].join(" \\\n  "),
	);
};
