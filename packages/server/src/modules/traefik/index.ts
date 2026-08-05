/**
 * Traefik module: dynamic file-provider config per app, static config +
 * swarm service bootstrap, and host/remote file helpers.
 *
 * Locked inter-module contract: `writeAppTraefikConfig` and
 * `removeTraefikConfig` (consumed by the application, compose, projects
 * and deployment modules).
 */

export type {
	TraefikBasicAuthEntry,
	TraefikDomainEntry,
	TraefikRedirectEntry,
	WriteAppTraefikConfigInput,
} from "./config-writer";
export {
	buildTraefikFileConfig,
	removeFileOnServer,
	removeTraefikConfig,
	writeAppTraefikConfig,
	writeFileOnServer,
} from "./config-writer";
export {
	getCertificatesDir,
	getConfigDir,
	getDynamicDir,
	getTraefikDir,
	REMOTE_TRAEFIK_DIR,
	TRAEFIK_ACME_CONTAINER_PATH,
	TRAEFIK_CERTIFICATES_CONTAINER_DIR,
	TRAEFIK_DYNAMIC_CONTAINER_DIR,
} from "./paths";
export {
	buildTraefikStaticConfig,
	ensureTraefikSetup,
	TRAEFIK_IMAGE,
	TRAEFIK_SERVICE_NAME,
} from "./setup";
