/**
 * Filesystem locations for Nixploy's Traefik configuration.
 *
 * Host layout (created by install.sh / ensureTraefikSetup):
 *   <configDir>/traefik/traefik.yml   — static config (bind-mounted read-only)
 *   <configDir>/traefik/dynamic/      — file-provider directory (watched)
 *   <configDir>/traefik/acme.json     — Let's Encrypt account + certs
 *
 * The nixploy-traefik container bind-mounts the dynamic directory at the
 * fixed target `/etc/nixploy/traefik/dynamic` (see install.sh), so paths
 * referenced from generated YAML (cert files, acme storage) always use the
 * container-side constant regardless of the host's config dir.
 */

import { getConfigDir } from "../deployment/paths";

/** Host-side root of all Nixploy state — see `deployment/paths.ts`. */
export { getConfigDir };

/** Host-side Traefik config directory. */
export const getTraefikDir = (): string => `${getConfigDir()}/traefik`;

/** Host-side directory watched by Traefik's file provider. */
export const getDynamicDir = (): string => `${getTraefikDir()}/dynamic`;

/** Host-side directory where uploaded certificate files are written. */
export const getCertificatesDir = (): string => `${getDynamicDir()}/certificates`;

/** Mount target of the dynamic directory inside the nixploy-traefik container. */
export const TRAEFIK_DYNAMIC_CONTAINER_DIR = "/etc/nixploy/traefik/dynamic";

/** Certificate directory as seen by the Traefik container. */
export const TRAEFIK_CERTIFICATES_CONTAINER_DIR = `${TRAEFIK_DYNAMIC_CONTAINER_DIR}/certificates`;

/** Path of acme.json as seen by the Traefik container. */
export const TRAEFIK_ACME_CONTAINER_PATH = "/etc/nixploy/traefik/acme.json";

/**
 * Traefik config directory on remote managed servers. Remote hosts are
 * provisioned as root by install.sh, so the production default always
 * applies there (the local dev fallback never does).
 */
export const REMOTE_TRAEFIK_DIR = "/etc/nixploy/traefik";
