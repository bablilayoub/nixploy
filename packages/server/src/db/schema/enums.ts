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

export const deploymentStatus = pgEnum("deployment_status", [
	"running",
	"done",
	"error",
	"cancelled",
]);

export const previewStatus = pgEnum("preview_status", ["idle", "running", "done", "error"]);

export const certificateType = pgEnum("certificate_type", ["letsencrypt", "custom", "none"]);

export const domainType = pgEnum("domain_type", ["application", "compose", "preview"]);

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
