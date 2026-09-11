# Audit log & roles

## Audit log

Every meaningful mutation appends to the org-scoped `audit_log` table and is
visible in **Monitoring → Audit log** (filter by action, target type, text
search, paginated).

- Table: `packages/server/src/db/schema/audit.ts` — actor (user + email),
  dot-namespaced `action` (e.g. `application.deploy`, `domain.delete`,
  `member.invite`, `docker.system.prune`), target (type/id/name), client `ip`
  and `userAgent`, free-form JSON `metadata` (never secrets), timestamp.
  Indexed on (organizationId, createdAt).
- `ip` is resolved through the trusted-proxy policy (`TRUSTED_PROXIES` plus the
  socket-peer check in `utils/rate-limit.ts`), so it is never a forged
  `X-Forwarded-For`; it reads `unknown` when no proxy is trusted. Auth events
  (`auth.login`, `auth.login.failed`, `auth.2fa.*`, `admin.user.*`) record the
  same two columns — they used to hide inside `metadata`.
- `organization_id` is nullable: an auth event by a user who belongs to no
  organization yet is recorded as an instance-level row instead of being
  dropped.
- Writing: `recordAudit(entry)` / `auditFromSession(ctx, orgId, entry)` from
  `packages/server/src/modules/audit`. **Fire-and-forget by design** — audit
  failures log to the console and never break the mutation.
- Covered today: project create/delete; application/compose/database create,
  delete, deploy, duplicate, move; environment clone; domain create/delete;
  server create/delete; Docker container remove + system prune; member join,
  role change, removal and invitations (via better-auth `databaseHooks` in
  `packages/server/src/lib/auth.ts`).
- Reading: `audit.all` (paged; filters by action, target type, target-name
  search and a `since`/`until` window — an ISO timestamp or a relative `30m` /
  `24h` / `7d`), `audit.facets` (distinct actions/types for the filter
  dropdowns) and `audit.export`.
- Exporting: **Monitoring → Audit log → Export CSV** downloads the trail under
  the filters currently on screen. The CSV carries every column, including
  `organizationId`, `actorId`, `ip`, `userAgent` and the raw `metadata` blob —
  more than the table shows. The same thing from a terminal:

  ```bash
  nixploy audit list --since 24h
  nixploy audit export --since 30d -o audit.csv
  ```

  `audit.export` is capped at 10 000 rows per call (default 5 000); narrow the
  window to page through a longer history.

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
