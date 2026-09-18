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
	// Managing teams *is* the admin surface for project scoping: it is gated on
	// `members.manage` and filtered by the resolved organization, and it must
	// keep listing every project so an admin can assign one. Isolation is the
	// org filter in the router, not a project filter.
	"team.all",
] as const;

export const LIST_GET_SUFFIXES = [".all", ".one", ".list"] as const;

export const isListOrGetProcedure = (path: string): boolean =>
	LIST_GET_SUFFIXES.some((suffix) => path.endsWith(suffix));

/* -------------------------------------------------------------------------- */
/*  The project axis                                                          */
/* -------------------------------------------------------------------------- */

/**
 * How a list/get procedure answers the *second* tenancy question.
 *
 * The organization axis above asks "is this row another tenant's?". Teams add
 * a narrower one: "is this row in a project the caller's teams reach?"
 * (`modules/projects/project-scope.ts`). The two are independent — a row can
 * be in the right organization and still be invisible — so a procedure that
 * declares one has said nothing about the other.
 *
 * - `filtered` — narrows by the caller's filter itself, in SQL
 *   (`projectIdFilter`) or in memory (`visibleProjectIds`).
 * - `inherited` — reaches its rows only through a tenancy funnel that already
 *   calls `assertProjectVisible` (`findProjectById`, `findEnvironmentById`,
 *   `assertApplicationAccess`, `assertEnvironmentAccess`, `findComposeForOrg`,
 *   `getServiceContext`). The cheapest correct answer, and the reason adding a
 *   service router needs no work here.
 * - `exempt` — the rows are not project data at all (instance resources, the
 *   template catalog, the caller's own memberships, the org-wide audit trail).
 *
 * A new list/get procedure fails `tenancy.test.ts` until it picks one, which
 * is the point: the filter travels in an AsyncLocalStorage store, so forgetting
 * it is silent rather than a type error.
 */
export type ProjectAxis = "filtered" | "inherited" | "exempt";

export const PROJECT_AXIS: Record<string, ProjectAxis> = {
	// Narrows by the caller's filter directly.
	"project.all": "filtered",

	// Funnelled through `findProjectById` / `findEnvironmentById` /
	// `assertApplicationAccess` / `assertEnvironmentAccess` / `getServiceContext`.
	"project.one": "inherited",
	"application.all": "inherited",
	"application.one": "inherited",
	"compose.all": "inherited",
	"compose.one": "inherited",
	"postgres.all": "inherited",
	"postgres.one": "inherited",
	"mysql.all": "inherited",
	"mysql.one": "inherited",
	"mariadb.all": "inherited",
	"mariadb.one": "inherited",
	"mongo.all": "inherited",
	"mongo.one": "inherited",
	"redis.all": "inherited",
	"redis.one": "inherited",
	// Nested under a service that was fetched through one of those funnels.
	"backup.all": "inherited",
	"backup.one": "inherited",
	"volumeBackup.all": "inherited",
	"volumeBackup.one": "inherited",
	"domain.all": "inherited",
	"domain.one": "inherited",
	"mount.one": "inherited",
	"port.one": "inherited",
	"redirect.one": "inherited",
	"security.one": "inherited",
	"schedule.all": "inherited",
	"schedule.one": "inherited",
	"rollback.all": "inherited",
	"rollback.one": "inherited",
	"previewDeployment.list": "inherited",
	"previewDeployment.one": "inherited",

	// Not project data.
	"template.all": "exempt",
	"template.one": "exempt",
	"server.all": "exempt",
	"server.one": "exempt",
	"destination.all": "exempt",
	"destination.one": "exempt",
	"registry.all": "exempt",
	"registry.one": "exempt",
	"sshKey.all": "exempt",
	"sshKey.one": "exempt",
	"certificate.all": "exempt",
	"certificate.one": "exempt",
	"notification.all": "exempt",
	"notification.one": "exempt",
	"github.all": "exempt",
	"github.one": "exempt",
	"gitlab.all": "exempt",
	"gitlab.one": "exempt",
	"gitea.all": "exempt",
	"gitea.one": "exempt",
	"bitbucket.all": "exempt",
	"bitbucket.one": "exempt",
	"sso.all": "exempt",
	"organization.list": "exempt",
	"volumeFiles.list": "exempt",
	// Tags are an organization-wide vocabulary; the services they are attached
	// to are filtered where those are listed.
	"tag.all": "exempt",
	// The audit trail records the organization's history, including actions on
	// projects a teams-scoped member cannot open — and it is gated on
	// `audit.read`, which is an administrator's capability.
	"audit.all": "exempt",
	// See the EXEMPT note: the teams admin surface must see every project.
	"team.all": "exempt",
};
