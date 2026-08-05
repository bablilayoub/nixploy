# Audit log & roles

## Audit log

Every meaningful mutation appends to the org-scoped `audit_log` table and is
visible in **Settings → Activity** (filter by action, target type, text
search, paginated).

- Table: `packages/server/src/db/schema/audit.ts` — actor (user + email),
  dot-namespaced `action` (e.g. `application.deploy`, `domain.delete`,
  `member.invite`, `docker.system.prune`), target (type/id/name), free-form
  JSON `metadata` (never secrets), timestamp. Indexed on
  (organizationId, createdAt).
- Writing: `recordAudit(entry)` / `auditFromSession(ctx, orgId, entry)` from
  `packages/server/src/modules/audit`. **Fire-and-forget by design** — audit
  failures log to the console and never break the mutation.
- Covered today: project create/delete; application/compose/database create,
  delete, deploy, duplicate, move; environment clone; domain create/delete;
  server create/delete; Docker container remove + system prune; member join,
  role change, removal and invitations (via better-auth `databaseHooks` in
  `packages/server/src/lib/auth.ts`).
- Reading: `audit.all` (paged, filtered) and `audit.facets` (distinct
  actions/types for the filter dropdowns).

## Roles

Org members have better-auth roles: `owner` > `admin` > `member`.

- `assertOrgRole(userId, organizationId, minRole)` in
  `packages/server/src/modules/projects/index.ts` throws FORBIDDEN unless
  the caller's rank meets `minRole`.
- Enforced at **admin** for: Docker mutations, server create/remove, project
  delete. better-auth's organization plugin additionally enforces its own
  rules for member/invitation management.
- Member management UI: Settings → Organization (invite with role picker,
  pending invitations with cancel, change role, remove member).
