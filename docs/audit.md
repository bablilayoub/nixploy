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

Org members have ranks:

`viewer` < `member` < `deployer` < `admin` < `owner`

| Role | Can |
|------|-----|
| **viewer** | Read dashboards, status, logs, metrics. No mutations. Secrets (env, DB passwords, tokens, notification configs) are redacted. |
| **member** | Create/update service config, domains, ports, redirects, env vars; AI chat/explain. |
| **deployer** | Everything member can, plus deploy / redeploy / start / stop / rollback / preview / backups run+restore / template deploy. |
| **admin** | Everything deployer can, plus delete resources, invites, servers, SSH keys, registries, git providers, notifications, certificates, mounts, Docker control, schedules, gitops apply, Traefik/web-server/AI settings. |
| **owner** | Same as admin for tRPC gates (highest rank). better-auth additionally owns org lifecycle. |

Enforcement:

- `assertOrgRole(userId, organizationId, minRole)` in
  `packages/server/src/modules/projects/index.ts` throws `FORBIDDEN` unless
  the caller's rank meets `minRole`. Comma-separated better-auth roles take
  the maximum rank; unknown roles count as viewer.
- `hasOrgRole(...)` is the non-throwing variant used when redacting secrets
  on reads.
- better-auth's organization plugin AC still gates member/invitation
  management on the auth API (viewers have empty org permissions).
- Member management UI: Settings → Organization (shareable invite link,
  role picker, cancel invite, change role, remove member).
