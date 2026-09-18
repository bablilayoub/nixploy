/**
 * Registry of tenant-scoped list/get procedures for isolation coverage.
 *
 * Every `*.all` / `*.one` / `*.list` procedure on `appRouter` must appear in
 * either `COVERED` (has an isolation assertion in `tenancy.test.ts`) or
 * `EXEMPT` (not org-row data, or covered indirectly). Adding a new list/get
 * without updating this file fails the coverage test.
 */

/** Procedures exercised by isolation assertions in tenancy.test.ts. */
export const COVERED = [
	"project.all",
	"project.one",
	"application.all",
	"application.one",
	"compose.all",
	"compose.one",
	"server.all",
	"server.one",
	"destination.all",
	"destination.one",
	"registry.all",
	"registry.one",
	"sshKey.all",
	"sshKey.one",
	"certificate.all",
	"certificate.one",
	"notification.all",
	"notification.one",
	"postgres.all",
	"postgres.one",
	"tag.all",
] as const;

/**
 * List/get procedures that do not expose another org's rows (catalog, host,
 * nested under a parent already covered, etc.).
 */
export const EXEMPT = [
	// Global catalog — not tenant data.
	"template.all",
	"template.one",
	// Same `buildDatabaseRouter` as postgres (covered); engines differ only in columns.
	"mysql.all",
	"mysql.one",
	"mariadb.all",
	"mariadb.one",
	"mongo.all",
	"mongo.one",
	"redis.all",
	"redis.one",
	// Nested under a service/application already org-checked on parent get.
	"rollback.all",
	"rollback.one",
	"previewDeployment.one",
	// Org-checked on the parent it names (application.one / compose.one are covered).
	"previewDeployment.list",
	"schedule.one",
	"schedule.all",
	"security.one",
	"redirect.one",
	"port.one",
	"mount.one",
	"backup.all",
	"backup.one",
	"volumeBackup.all",
	"volumeBackup.one",
	"domain.all",
	"domain.one",
	// Provider connections — add COVERED cases when seeding git providers.
	"github.all",
	"github.one",
	"gitlab.all",
	"gitlab.one",
	"gitea.all",
	"gitea.one",
	"bitbucket.all",
	"bitbucket.one",
	// Instance-level, not tenant data: identity providers appear on the login
	// page for the whole instance, and the procedure is instance admin only.
	"sso.all",
	// Audit is org-filtered; covered indirectly via project seed volume of work.
	"audit.all",
	// The caller's OWN memberships, not org rows: `organization.list` joins
	// through `member.user_id = ctx.session.user.id`, so an organization the
	// caller does not belong to cannot appear in the result at all. There is no
	// second tenant's row for an isolation assertion to catch.
	"organization.list",
	// Docker volumes are instance-level resources, not org rows: `volumeFiles.*`
	// is gated on `docker.manage` + the instance-admin role, and a `serverId`
	// is verified against the caller's org before any SSH command
	// (`trpc/routers/volume-files.ts`). There is no tenant row to isolate.
	"volumeFiles.list",
] as const;

export const LIST_GET_SUFFIXES = [".all", ".one", ".list"] as const;

export const isListOrGetProcedure = (path: string): boolean =>
	LIST_GET_SUFFIXES.some((suffix) => path.endsWith(suffix));
