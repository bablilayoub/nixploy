import { readFile } from "node:fs/promises";
import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { getSwarmNetwork } from "../application/paths";
import { writeFileOnServer } from "./config-writer";
import {
	buildDefaultTlsYaml,
	DEFAULT_TLS_CONFIG_FILE,
	getDashboardDomain,
	writeDashboardRouterConfig,
} from "./dashboard";
import {
	loadTraefikEntrypoints,
	renderEntrypointsYaml,
	type TraefikEntrypointSpec,
} from "./entrypoints";
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

/** Shell-quote a string for POSIX sh (single-quote wrapping). */
const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Run a shell command on the Nixploy host or a managed server. */
const runOn = (serverId: string | null | undefined, command: string): Promise<string> =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

/**
 * Traefik DNS-01 providers Nixploy offers in the UI. The code is passed
 * straight to Traefik's `dnsChallenge.provider`; the provider's credentials
 * reach the proxy as environment variables (see docs/domains-traefik.md).
 */
export const ACME_DNS_PROVIDERS = [
	{ code: "cloudflare", label: "Cloudflare", envKeys: ["CF_DNS_API_TOKEN"] },
	{
		code: "route53",
		label: "AWS Route 53",
		envKeys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
	},
	{ code: "digitalocean", label: "DigitalOcean", envKeys: ["DO_AUTH_TOKEN"] },
	{ code: "gandiv5", label: "Gandi LiveDNS", envKeys: ["GANDIV5_PERSONAL_ACCESS_TOKEN"] },
	// Hetzner moved DNS into the Cloud API (2025): the legacy `dns.hetzner.com`
	// API behind `HETZNER_API_KEY` is gone, lego ≥ 4.27 reads the Cloud token.
	{ code: "hetzner", label: "Hetzner DNS", envKeys: ["HETZNER_API_TOKEN"] },
	{ code: "namecheap", label: "Namecheap", envKeys: ["NAMECHEAP_API_USER", "NAMECHEAP_API_KEY"] },
	{
		code: "ovh",
		label: "OVH",
		envKeys: ["OVH_ENDPOINT", "OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY"],
	},
	{ code: "vultr", label: "Vultr", envKeys: ["VULTR_API_KEY"] },
] as const;

export type AcmeDnsProviderCode = (typeof ACME_DNS_PROVIDERS)[number]["code"];

export interface AcmeDnsSettings {
	provider: string;
	/** Resolvers Traefik asks before considering the TXT record propagated. */
	resolvers?: string[];
	/** Provider credentials, as the env vars lego reads (`CF_DNS_API_TOKEN`, …). */
	credentials?: Record<string, string> | null;
}

/** Only the codes above may be rendered — the value lands in the static YAML. */
const normalizeDnsProvider = (provider: string | null | undefined): string | null => {
	const code = provider?.trim().toLowerCase();
	if (!code) return null;
	return ACME_DNS_PROVIDERS.some((entry) => entry.code === code) ? code : null;
};

/** Env var names a provider is allowed to set (its entry in {@link ACME_DNS_PROVIDERS}). */
const providerEnvKeys = (provider: string | null): readonly string[] =>
	ACME_DNS_PROVIDERS.find((entry) => entry.code === provider)?.envKeys ?? [];

/**
 * The environment Traefik needs for the DNS-01 challenge.
 *
 * lego (which Traefik embeds) reads provider credentials from the process
 * environment — there is no file or config field for them — so they have to
 * reach the proxy as env vars on its Swarm service. Two consequences worth
 * being explicit about: the values are readable with `docker service inspect`
 * on a manager, and they are briefly on the host's process list while the
 * `docker service` command runs. Both are root-on-the-manager territory, which
 * already holds the panel's encryption key; there is no shape of this feature
 * that avoids them.
 *
 * **Only the keys the selected provider declares are emitted.** The credentials
 * blob is operator-supplied, and an arbitrary key would otherwise be able to
 * set anything in Traefik's environment — or, with a crafted name, smuggle a
 * second flag into the command.
 */
export function buildAcmeDnsEnv(
	provider: string | null | undefined,
	credentials: Record<string, string> | null | undefined,
): Array<{ key: string; value: string }> {
	const code = normalizeDnsProvider(provider);
	if (!code || !credentials) return [];
	const allowed = providerEnvKeys(code);
	const env: Array<{ key: string; value: string }> = [];
	for (const key of allowed) {
		const value = credentials[key];
		// A blank value is "not configured", not "set to empty": passing it would
		// make lego fail with a confusing auth error instead of the clear
		// "provider not configured" one.
		if (typeof value !== "string" || value.trim() === "") continue;
		env.push({ key, value });
	}
	return env;
}

/** Keys a previous version of this table set; still swept off the proxy. */
const RETIRED_ACME_DNS_ENV_KEYS: readonly string[] = ["HETZNER_API_KEY"];

/** Every env key any provider could have set, so switching providers cleans up. */
const ALL_ACME_DNS_ENV_KEYS: readonly string[] = [
	...new Set([
		...ACME_DNS_PROVIDERS.flatMap((entry) => entry.envKeys as readonly string[]),
		...RETIRED_ACME_DNS_ENV_KEYS,
	]),
];

/**
 * `--env-add` / `--env-rm` flags that move the proxy's current environment to
 * the desired one, or `[]` when it already matches.
 *
 * Pure so the diff is testable: it decides whether the proxy's tasks are
 * recreated, and recreating them is a ~9 s outage for every routed domain.
 * Only keys this feature owns are ever removed — an operator who added their
 * own env var to the service keeps it.
 */
export function buildAcmeDnsEnvUpdate(
	current: readonly string[],
	desired: ReadonlyArray<{ key: string; value: string }>,
): string[] {
	const currentPairs = new Map<string, string>();
	for (const entry of current) {
		const eq = entry.indexOf("=");
		if (eq > 0) currentPairs.set(entry.slice(0, eq), entry.slice(eq + 1));
	}
	const desiredKeys = new Set(desired.map((entry) => entry.key));

	const flags: string[] = [];
	for (const key of ALL_ACME_DNS_ENV_KEYS) {
		if (!desiredKeys.has(key) && currentPairs.has(key)) {
			flags.push(`--env-rm ${shq(key)}`);
		}
	}
	for (const entry of desired) {
		if (currentPairs.get(entry.key) === entry.value) continue;
		flags.push(`--env-add ${shq(`${entry.key}=${entry.value}`)}`);
	}
	return flags;
}

/**
 * Traefik v3 static configuration. The file provider watches the dynamic
 * directory (hot-reload). There is **no entrypoint-level HTTP → HTTPS
 * redirect**: it would override every domain's `https` toggle. The config
 * writer emits a per-router `redirectScheme` middleware for each `https: true`
 * domain instead, so a domain with `https: false` is served plain on `:80`.
 * ACME uses the HTTP challenge on `web`.
 * TLS for bare IPs uses the self-signed defaultCertificate; app domains
 * attach `certResolver: letsencrypt` per-router in dynamic YAML.
 *
 * With a DNS provider configured a **second** resolver `letsencrypt-dns` is
 * appended for wildcard hosts (HTTP-01 cannot validate `*.example.com`).
 * `entrypoints` adds one `entryPoints:` entry per `traefik_entrypoint` row for
 * layer-4 (TCP/UDP) routing. With neither — the default, and what CI diffs
 * against `docker/traefik/traefik.yml`, `install.sh` and `update.sh` — the
 * rendered file is unchanged.
 */
export const buildTraefikStaticConfig = (
	letsEncryptEmail?: string | null,
	acmeDns?: AcmeDnsSettings | null,
	entrypoints: readonly TraefikEntrypointSpec[] = [],
): string => {
	const email = letsEncryptEmail?.trim() || "nixploy@localhost";
	const dnsProvider = normalizeDnsProvider(acmeDns?.provider);
	const dnsResolver = dnsProvider
		? // Same acme.json as the HTTP-01 resolver: Traefik keys its storage by
			// resolver name, so no extra bind mount is needed on upgrade.
			`  letsencrypt-dns:
    acme:
      email: ${email}
      storage: ${TRAEFIK_ACME_CONTAINER_PATH}
      dnsChallenge:
        provider: ${dnsProvider}
`
		: "";
	return `global:
  checkNewVersion: false
  sendAnonymousUsage: false
log:
  level: ERROR
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
${renderEntrypointsYaml(entrypoints)}providers:
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
${dnsResolver}api:
  dashboard: false
`;
};

/** ACME email + DNS-01 provider from the singleton settings row. */
export const getAcmeSettings = async (): Promise<{
	email: string | null;
	dns: AcmeDnsSettings | null;
}> => {
	const [settings] = await db.select().from(webServerSettings).limit(1);
	return {
		email: settings?.letsEncryptEmail ?? null,
		dns: settings?.acmeDnsProvider
			? {
					provider: settings.acmeDnsProvider,
					credentials: (settings.acmeDnsCredentials ?? null) as Record<string, string> | null,
				}
			: null,
	};
};

/** Current `traefik.yml` on the target host; `null` when missing or empty. */
const readStaticConfig = async (
	serverId: string | null | undefined,
	filePath: string,
): Promise<string | null> => {
	if (serverId) {
		const content = await runOn(serverId, `cat ${shq(filePath)} 2>/dev/null || true`);
		return content || null;
	}
	return readFile(filePath, "utf8").catch(() => null);
};

/**
 * The proxy service's current environment as `KEY=VALUE` lines. Empty when the
 * service is missing or the daemon cannot be read — the caller then treats
 * every desired variable as new, which is the safe direction (it sets them
 * again rather than assuming they are already there).
 */
const readTraefikEnv = async (serverId: string | null | undefined): Promise<string[]> => {
	try {
		const out = await runOn(
			serverId,
			`docker service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' ${TRAEFIK_SERVICE_NAME}`,
		);
		return out
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

/**
 * Whether the proxy service exists on the target. `service ls` filters names
 * by prefix and rejects regex anchors, so the exact match is done here.
 */
const traefikServiceExists = async (serverId: string | null | undefined): Promise<boolean> => {
	const existing = await runOn(
		serverId,
		`docker service ls --filter name=${TRAEFIK_SERVICE_NAME} --format '{{.Name}}'`,
	);
	return existing
		.split("\n")
		.map((name) => name.trim())
		.includes(TRAEFIK_SERVICE_NAME);
};

/**
 * Restart the proxy so it re-reads `traefik.yml`. Traefik loads its static
 * configuration (ACME email/resolver, entrypoints) once at start — only the
 * dynamic directory hot-reloads — so a changed Let's Encrypt email has no
 * effect until the tasks are recreated. `--detach` returns as soon as the
 * update is accepted; the global service rolls its (single) task over.
 */
export const restartTraefik = async (serverId?: string | null): Promise<void> => {
	await runOn(serverId, `docker service update --force --detach ${TRAEFIK_SERVICE_NAME}`);
};

/**
 * Self-signed default cert + dashboard routing (catch-all for bare-IP HTTPS
 * plus the configured domain, if any). The cert is generated only when
 * missing; the YAML files are always refreshed.
 */
/**
 * Generate the self-signed default cert. Uses a short timeout so `ip` /
 * openssl quirks on macOS never hang Traefik boot (which previously led to
 * `NIXPLOY_DISABLE_TRAEFIK_BOOT` workarounds).
 */
const ensureDefaultTlsCert = async (serverId?: string | null): Promise<void> => {
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();
	const certPath = `${dynamicDir}/default.crt`;
	const keyPath = `${dynamicDir}/default.key`;

	const command = [
		`mkdir -p ${shq(dynamicDir)}`,
		`if [ ! -f ${shq(certPath)} ] || [ ! -f ${shq(keyPath)} ]; then`,
		`  SAN="DNS:localhost,IP:127.0.0.1"`,
		`  if ! openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout ${shq(keyPath)} -out ${shq(certPath)} -subj "/CN=nixploy" -addext "subjectAltName=\${SAN}" 2>/dev/null; then`,
		`    openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout ${shq(keyPath)} -out ${shq(certPath)} -subj "/CN=nixploy"`,
		`  fi`,
		`  chmod 600 ${shq(keyPath)} ${shq(certPath)}`,
		`fi`,
	].join("\n");

	if (serverId) {
		await runOn(serverId, command);
		return;
	}

	const { execAsync } = await import("../../utils/exec");
	await execAsync(command, { timeout: 15_000 });
};

const ensureDefaultTlsAndDashboard = async (serverId?: string | null): Promise<void> => {
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();

	await ensureDefaultTlsCert(serverId);

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
 * 5. create the global `nixploy-traefik` swarm service if missing — or, when
 *    it exists and the static config changed, restart it so the change is
 *    actually picked up (unchanged content, i.e. every normal boot, leaves
 *    the running proxy alone).
 *
 * Swarm itself must already be active (install.sh / cluster setupServer).
 */
export const ensureTraefikSetup = async (serverId?: string | null): Promise<void> => {
	const traefikDir = serverId ? REMOTE_TRAEFIK_DIR : getTraefikDir();
	const dynamicDir = serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic` : getDynamicDir();
	const staticPath = `${traefikDir}/traefik.yml`;
	const acmePath = `${traefikDir}/acme.json`;
	const network = getSwarmNetwork();

	// 1. Static config (rewritten every call so settings changes take effect).
	// An unset email keeps the `nixploy@localhost` sentinel, so the content —
	// and therefore the restart decision below — only moves when it changes.
	const acme = await getAcmeSettings();
	const entrypoints = await loadTraefikEntrypoints();
	const staticConfig = buildTraefikStaticConfig(acme.email, acme.dns, entrypoints);
	const staticChanged = (await readStaticConfig(serverId, staticPath)) !== staticConfig;
	await writeFileOnServer(staticPath, staticConfig, serverId);

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

	// 5. The proxy service itself — created once. Afterwards only a changed
	// traefik.yml (new ACME email from Settings, a template change shipped by
	// an upgrade) touches it, via a restart: the static config is read once at
	// start, so rewriting the file alone changed nothing for the running proxy.
	const dnsEnv = buildAcmeDnsEnv(acme.dns?.provider, acme.dns?.credentials);

	if (await traefikServiceExists(serverId)) {
		// The DNS-01 credentials live in the service's environment, so a changed
		// token is applied with `--env-add` rather than by rewriting a file.
		// Diffed first: `--env-add` recreates the proxy's task, and that is a
		// ~9 s outage for every routed domain (measured) — far too expensive to
		// pay on every settings save.
		const envFlags = buildAcmeDnsEnvUpdate(await readTraefikEnv(serverId), dnsEnv);
		if (envFlags.length > 0) {
			await runOn(
				serverId,
				`docker service update --detach ${envFlags.join(" ")} ${TRAEFIK_SERVICE_NAME}`,
			);
			// That update already recreated the task, so it re-read traefik.yml too.
			return;
		}
		if (staticChanged) {
			await restartTraefik(serverId);
		}
		return;
	}

	// `--detach` returns as soon as the service is accepted so first-time
	// image pulls don't block app boot past the Traefik timeout.
	await runOn(
		serverId,
		[
			"docker service create",
			"--detach",
			`--name ${TRAEFIK_SERVICE_NAME}`,
			"--mode global",
			"--constraint node.role==manager",
			`--network ${network}`,
			"--publish mode=host,target=80,published=80",
			"--publish mode=host,target=443,published=443",
			// Layer-4 entrypoints declared in the static config above must also
			// be published, or the port is open inside the container only.
			...entrypoints.map(
				(entry) =>
					`--publish mode=host,target=${entry.port},published=${entry.port},protocol=${entry.protocol}`,
			),
			`--mount type=bind,source=${staticPath},destination=/etc/traefik/traefik.yml,readonly`,
			`--mount type=bind,source=${dynamicDir},destination=${TRAEFIK_DYNAMIC_CONTAINER_DIR}`,
			`--mount type=bind,source=${acmePath},destination=${TRAEFIK_ACME_CONTAINER_PATH}`,
			...dnsEnv.map((entry) => `--env ${shq(`${entry.key}=${entry.value}`)}`),
			TRAEFIK_IMAGE,
		].join(" \\\n  "),
	);
};
