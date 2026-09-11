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
	TraefikDomainRow,
	TraefikMiddlewareEntry,
	TraefikRedirectEntry,
	TraefikRouteProtocol,
	TraefikTlsMode,
	WriteAppTraefikConfigInput,
} from "./config-writer";
export {
	assertEntrypointName,
	buildTraefikFileConfig,
	DEFAULT_CONTAINER_PORT,
	DNS_CERT_RESOLVER,
	isWildcardHost,
	RESERVED_ENTRYPOINT_NAMES,
	removeFileOnServer,
	removeTraefikConfig,
	TRAEFIK_ENTRYPOINT_NAME_RE,
	toTraefikDomainEntry,
	writeAppTraefikConfig,
	writeFileOnServer,
} from "./config-writer";
export {
	buildDashboardRouterYaml,
	getDashboardDomain,
	normalizeDashboardDomain,
	writeDashboardRouterConfig,
} from "./dashboard";
export type { EntrypointProtocol, TraefikEntrypointSpec } from "./entrypoints";
export {
	applyTraefikEntrypoints,
	assertEntrypointUnused,
	assertValidEntrypoint,
	buildPublishUpdateArgs,
	desiredPublishedPorts,
	loadTraefikEntrypoints,
	renderEntrypointsYaml,
} from "./entrypoints";
export type { DomainMiddlewareKind } from "./middlewares";
export {
	DOMAIN_MIDDLEWARE_KINDS,
	describeMiddleware,
	domainMiddlewareKindSchema,
	parseForwardAuthAddress,
	parseMiddlewareConfig,
} from "./middlewares";
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
export type { AcmeDnsSettings } from "./setup";
export {
	ACME_DNS_PROVIDERS,
	buildTraefikStaticConfig,
	ensureTraefikSetup,
	restartTraefik,
	TRAEFIK_IMAGE,
	TRAEFIK_SERVICE_NAME,
} from "./setup";
