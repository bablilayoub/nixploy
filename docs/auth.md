# Auth & organizations

Authentication is [better-auth](https://better-auth.com) (v1.7.x) with its
organization plugin, Drizzle adapter, and the two-factor (TOTP) plugin. Config
lives in `packages/server/src/lib/auth.ts`; the handler is mounted at
`/api/auth/*` in the Next.js app. The web client is
`apps/web/src/lib/auth-client.ts`.

## First-boot setup (no public register)

Self-hosted instances must not leave an open `/register` page. Nixploy mirrors
Dokploy:

1. When the `user` table is empty, unauthenticated visitors are sent to
   **`/setup`** to create the owner account (name, email, password).
2. That signup is allowed only while `needsSetup()` is true (or later when the
   email matches a pending organization invitation).
3. The first user is given `role: "admin"` and creates `<name>'s Org`.
4. After that, public registration is blocked. Teammates join via a
   **shareable invite link** from Settings → Organization (no SMTP): the admin
   copies `/accept-invitation/<id>` and gives it to the invitee, who creates
   their account (name/password; email locked to the invite) and joins.
5. Legacy `/register` permanently redirects to `/setup`.

Probe: `setup.needsSetup` and `setup.invitationPreview` (public tRPC). Helpers
live in `packages/server/src/modules/auth/setup.ts`.

## Sessions & the active organization

- better-auth sessions carry `activeOrganizationId` — the org the user is
  currently acting for. The org switcher (`org-switcher.tsx`) calls
  `/api/auth/organization/set-active`.
- **Never read `activeOrganizationId` raw in tRPC code and never hard-fail on
  it being null.** Stale sessions (created before org selection, or after
  better-auth upgrades) legitimately have it unset. Always resolve through:

  ```ts
  import { resolveCallerOrganizationId } from "../../modules/projects";

  const organizationId = await resolveCallerOrganizationId(
    ctx.session.user.id,
    ctx.session.session.activeOrganizationId,
  );
  ```

  It validates membership when an active org is set, and falls back to the
  caller's first membership (by `member.createdAt`) otherwise. It only throws
  `FORBIDDEN` when the user belongs to no organization at all.
  `getOrganizationId` in `modules/application/org.ts` is an async convenience
  wrapper around it — always `await` it.
- After resolving, queries must still filter rows by the resolved org id
  (usually via `service → environment → project → organizationId`; helpers
  like `assertApplicationAccess` do this).

## Organization roles & capabilities

Org membership uses a role ladder (`viewer` < `member` < `deployer` <
`admin` < `owner`) plus an optional **capability overlay** per member
(`member.capability_overrides` JSON: `{ grant?, revoke? }`).

Effective set = role defaults ∪ grant − revoke. Mutations should call
`assertCapability(userId, orgId, capability)` (use `hasCapability` for soft
gates such as masking secrets). Roles still feed better-auth AC and coarse UI;
capabilities are the fine-grained gate.

### Catalog (grouped)

| Group | Capabilities |
| --- | --- |
| Projects | `project.write`, `project.delete` |
| Services | `service.create`, `service.write`, `service.delete`, `service.deploy`, `service.runtime`, `tags.manage`, `templates.deploy` |
| Secrets & domains | `secrets.read`, `secrets.write`, `domains.manage` |
| Automation | `backups.manage`, `schedules.manage`, `gitops.manage`, `ai.use` |
| Infrastructure | `servers.manage`, `registries.manage`, `destinations.manage`, `certificates.manage`, `ssh_keys.manage`, `git_providers.manage`, `docker.manage`, `notifications.manage` |
| Organization | `members.manage`, `settings.manage`, `audit.read` |

Labels and descriptions live in `CAPABILITY_CATALOG`
(`modules/projects/capabilities.ts`). Settings → Organization → Members
(shield) edits overlays; `organization.capabilityCatalog` /
`organization.myCapabilities` power the UI.

### Role defaults

| Role | Baseline |
| --- | --- |
| `viewer` | `audit.read` |
| `member` | project/service write (no deploy/delete), secrets, domains, tags, AI, audit |
| `deployer` | member + deploy/runtime, templates, backups, schedules |
| `admin` / `owner` | full catalog |

## Instance admin

The first user (better-auth `admin()` plugin, `user.role = "admin"`) is the
**instance admin** — the only trusted-root identity. Org roles and
capabilities stop at the organization boundary; anything that reaches the
shared host or cluster additionally requires `assertInstanceAdmin(session)`
(`modules/auth/instance-admin.ts`), whatever the caller's org role:

- **Swarm joins** — `server.setup` (the actual `docker swarm join`) and any
  `swarmRole: "manager"` on `server.create` / `server.update`. A manager sees
  and controls every tenant's services; even a worker runs other orgs'
  unpinned tasks as root. `servers.manage` still lets an org register, edit
  and remove its server rows. Every setup run is audited as `server.setup`
  with the role and result.
- **Cluster-wide Docker** — `docker.nodes`, `nodeUpdate`, `swarmServices`,
  system prune (see [docker.md](./docker.md)).
- **Host-privileged compose** — templates that mount `docker.sock` or add
  capabilities create rows with `hostPrivileged = true`; `compose.update`
  and `compose.saveComposeFile` on such a row are instance-admin only, and
  any source change by another path (GitOps apply) demotes the row to the
  strict safety check.
- Host bind mounts, host TLS store, `nixploy-server` schedules, instance
  backups, self-update, the AI singleton and the Traefik host settings.

Keep the instance-admin account on 2FA and do not hand its API keys to CI:
a key carries the owner's full capability set, including these gates.

## Two-factor authentication (TOTP)

- Profile → security card: enable requires the password, shows a QR code
  (generated client-side with the `qrcode` package from the `otpauth://` URI
  returned by `/api/auth/two-factor/enable`), then verifies a code.
- The `two_factor` table needs better-auth's current columns: `secret`,
  `backupCodes`, plus `verified` (bool), `failedVerificationCount` (int),
  `lockedUntil` (timestamptz) — missing columns silently break enable/verify;
  keep the Drizzle schema in `db/schema/auth.ts` in sync with the plugin
  version when upgrading better-auth.
- Login with 2FA enabled routes through `/two-factor` after password sign-in.

### Org-level enforcement

- Settings → Organization → Security → **Require two-factor authentication**
  (`organization.requireTwoFactor`, default off; owner/admin via
  `organization.updateSettings`).
- When on, members whose account has no 2FA are blocked from **every
  org-scoped tRPC procedure** (middleware in `trpc/init.ts`, predicate in
  `modules/auth/two-factor-gate.ts`) and the dashboard layout swaps in a
  "Two-factor authentication required" interstitial with the setup card
  instead of the app. 2FA setup runs through better-auth routes, so a gated
  member can always enable it and continue; users with no organization
  (first-run setup) are exempt.

## API keys (REST & CLI)

Rate limits: every API-key request is limited **per key** (120/min) plus a
per-IP bucket that is only consumed by failed verifications; webhook and
public setup endpoints keep per-IP buckets. Set `TRUSTED_PROXIES=1` (the
installer does) or a comma-separated CIDR list so the real client IP is read
from `X-Forwarded-For`/`X-Real-IP` behind Traefik — the same value feeds
better-auth's own limiter.

Invitations over API keys: `organization.inviteMember` creates the invitation
row directly, so CI and MCP clients can invite. The invitee's sign-up must
carry the header `x-nixploy-invitation-id: <invitationId>` with a pending,
unexpired invitation for that exact email (the accept-invitation page sends
it); any other public sign-up is refused once the first admin exists.


- Every tRPC procedure is also exposed as REST under `/api/<router>.<procedure>`
  (documented at `/swagger`; see [api.md](./api.md)) and is reachable from
  `@nixploy/cli`.
- Authentication: `x-api-key` header. Keys are created in Settings → Profile →
  API keys, stored hashed via the `@better-auth/api-key` plugin, and resolve
  to the owning user (org resolution then follows the same rules as sessions).

## Secrets at rest

Columns holding secrets (env vars, database passwords, registry credentials,
tokens) use the `encryptedText` column helper
(`packages/server/src/db/custom-columns.ts`), AES-encrypted with
`ENCRYPTION_KEY`. Losing that key makes stored secrets unreadable — back it up
with the same care as the database.

Production install (`install.sh`) writes `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
Postgres password and `BETTER_AUTH_URL` to `/etc/nixploy/.env`.
