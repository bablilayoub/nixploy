import { pgEnum } from "drizzle-orm/pg-core";

/** Lifecycle status shared by every deployable service. */
export const serviceStatus = pgEnum("service_status", ["idle", "running", "done", "error"]);

export const applicationSourceType = pgEnum("application_source_type", [
	"docker",
	"git",
	"github",
	"gitlab",
	"bitbucket",
	"gitea",
	"drop",
]);

export const composeSourceType = pgEnum("compose_source_type", [
	"git",
	"github",
	"gitlab",
	"bitbucket",
	"gitea",
	"raw",
]);

export const buildType = pgEnum("build_type", [
	"dockerfile",
	"heroku_buildpacks",
	"paketo_buildpacks",
	"nixpacks",
	"static",
	"railpack",
]);

export const composeType = pgEnum("compose_type", ["docker-compose", "stack"]);

/**
 * `queued` = accepted, waiting for a worker slot; `running` = the worker owns
 * it. Only the deploy queue moves rows between the two (see
 * `modules/deployment/index.ts`).
 */
export const deploymentStatus = pgEnum("deployment_status", [
	"queued",
	"running",
	"done",
	"error",
	"cancelled",
]);

/**
 * What started a deployment. `manual` = a signed-in user clicked Deploy,
 * `api` = REST/CLI/MCP call with an API key, `webhook` = provider push,
 * `system` = boot recovery / internal maintenance.
 */
export const deploymentTrigger = pgEnum("deployment_trigger", [
	"manual",
	"webhook",
	"api",
	"schedule",
	"preview",
	"rollback",
	"redeploy",
	"gitops",
	"system",
]);

export const backupRunKind = pgEnum("backup_run_kind", ["database", "volume", "instance"]);

export const backupRunStatus = pgEnum("backup_run_status", ["running", "success", "error"]);

export const previewStatus = pgEnum("preview_status", [
	"idle",
	"running",
	"done",
	"error",
	"awaiting_approval",
]);

export const certificateType = pgEnum("certificate_type", ["letsencrypt", "custom", "none"]);

export const domainType = pgEnum("domain_type", ["application", "compose", "preview"]);

/**
 * Layer-4 vs layer-7 routing for a domain row. `http` is the historical
 * behaviour (Traefik `http.routers` on `web`/`websecure`); `tcp`/`udp` emit
 * `tcp.routers`/`udp.routers` bound to a named entrypoint from
 * `traefik_entrypoint` (see `modules/traefik/entrypoints.ts`).
 */
export const domainProtocol = pgEnum("domain_protocol", ["http", "tcp", "udp"]);

/**
 * TLS handling for a TCP router. `none` matches every connection on the
 * entrypoint (`HostSNI(\`*\`)`); `terminate` lets Traefik present the
 * certificate and speak plaintext to the backend; `passthrough` forwards the
 * TLS stream untouched. Only `terminate`/`passthrough` can match a hostname —
 * SNI is the only thing a TCP router can read. UDP has no TLS at all.
 */
export const domainTlsMode = pgEnum("domain_tls_mode", ["none", "terminate", "passthrough"]);

/**
 * Traefik middleware kinds a domain can opt into. The set is closed on
 * purpose: every kind maps to one hand-written renderer + zod schema in
 * `modules/traefik/middlewares.ts`, so no tenant string ever reaches the
 * dynamic YAML unvalidated (there is no raw-YAML escape hatch).
 */
export const domainMiddlewareKind = pgEnum("domain_middleware_kind", [
	"rateLimit",
	"ipAllowList",
	"headers",
	"compress",
	"forwardAuth",
	"stickyCookie",
	"maintenance",
]);

export const mountType = pgEnum("mount_type", ["bind", "volume", "file"]);

/** Every kind of service a mount/port/domain can attach to. */
export const serviceType = pgEnum("service_type", [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
]);

export const portProtocol = pgEnum("port_protocol", ["tcp", "udp"]);

export const publishMode = pgEnum("publish_mode", ["ingress", "host"]);

export const registryType = pgEnum("registry_type", ["selfHosted", "cloud"]);

export const databaseType = pgEnum("database_type", [
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"web-server",
]);

export const notificationType = pgEnum("notification_type", [
	"slack",
	"telegram",
	"discord",
	"email",
	"gotify",
	"ntfy",
	"pushover",
	"mattermost",
	"lark",
	"teams",
	"custom",
]);

export const serverStatus = pgEnum("server_status", ["active", "inactive"]);

/** Role when joining the primary Docker Swarm. */
export const swarmRole = pgEnum("swarm_role", ["worker", "manager"]);

export const scheduleType = pgEnum("schedule_type", [
	"application",
	"compose",
	"server",
	"nixploy-server",
]);

export const shellType = pgEnum("shell_type", ["bash", "sh"]);

export const gitProviderType = pgEnum("git_provider_type", [
	"github",
	"gitlab",
	"bitbucket",
	"gitea",
]);
