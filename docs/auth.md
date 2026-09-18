# Auth & organizations

Authentication is [better-auth](https://better-auth.com) (v1.7.x) with its
organization plugin, Drizzle adapter, and the two-factor (TOTP) plugin. Config
lives in `packages/server/src/lib/auth.ts`; the handler is mounted at
`/api/auth/*` in the Next.js app. The web client is
`apps/web/src/lib/auth-client.ts`.

## First-boot setup (no public register)

Self-hosted instances must not leave an open `/register` page. Nixploy claims
the first admin instead:

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

Probe: `setup.needsSetup`, `setup.authConfig` and `setup.invitationPreview`
(public tRPC). Helpers live in `packages/server/src/modules/auth/setup.ts`.

The invitation preview returns the org name, the role and a **masked** email
(`ad••••••••••@example.com`): a leaked invite link must not disclose the
invitee's address. The accept page asks the invitee to type it, and the sign-up
is refused unless it matches the invitation.

### Setup token (installer)

"First visitor wins" is a race a scanner can win on a freshly installed host.
When `NIXPLOY_SETUP_TOKEN` is set, creating the first admin additionally
requires that token:

- the installer generates it, writes it to `/etc/nixploy/.env` and prints it
  with the panel URL (`https://panel.example.com/setup?token=<token>`);
- `/setup` prefills the field from `?token=` and shows it otherwise;
- the wizard sends it as `x-nixploy-setup-token`, and
  `databaseHooks.user.create.before` compares it in constant time.

Unset (upgrades, local development) keeps the old behaviour. The token only
guards the *first* admin — it is ignored once the instance has users.

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

**Rank-bound capabilities.** `servers.manage`, `docker.manage`,
`settings.manage` and `members.manage` carry `minRole: "admin"` in the catalog:
they reach the shared host or the organization itself, so an overlay can never
hand them to a `viewer`/`member`/`deployer` — change the member's role instead.
`organization.setMemberCapabilities` enforces the floor on `grant`, and
validates `revoke` against the caller's own set too.

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

Keep the instance-admin account on 2FA, and give CI a **scoped** key rather
than an `admin` one: an `admin`-scoped key created by an instance admin carries
that account's full capability set, including the gates above.

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

## Passwords

- **New** passwords (sign-up, invitation, reset, change) must be at least 12
  characters (`emailAndPassword.minPasswordLength`). Sign-in never checks
  length, so accounts created under the old 8-character floor keep working
  until they change their password.
- The setup, invitation and reset forms show a dependency-free strength hint
  (length + character classes) — advisory on top of the hard minimum.
- Sign-in is limited **per IP** by better-auth (10/min) **and per account**:
  10 failures inside 15 minutes lock that email for 15 minutes with a readable
  message. The per-account bucket is what a distributed credential-stuffing run
  hits. Failures are audited as `auth.login.failed`, the lock as
  `auth.login.locked`. Buckets are in-process, so a panel restart clears them.

### Password reset

`/forgot-password` → emailed link → `/reset-password/<token>` (one hour, single
use). Delivery uses the **instance's email notification channel**: the oldest
channel of type `email` in Settings → Notifications, with the recipient replaced
by the account asking for the reset. With no email channel configured the
endpoint answers 503 with "Email delivery is not configured on this instance —
ask your instance admin…" instead of silently promising a mail.

### Locked out with no email (break glass)

```bash
docker exec nixploy node scripts/reset-admin.mjs admin@example.com
```

Sets a random one-time password, removes the account's TOTP enrolment, revokes
every session and prints the password. Run it on the host; it reads
`DATABASE_URL` from the container environment. Sign in with the printed
password and change it immediately. (The better-auth admin plugin cannot clear
an enrolled TOTP secret, which is why this is a script and not a button.)

## Single sign-on

Configured in the panel: **Settings → Single sign-on** (instance admin only).
Providers are rows, not environment variables, so changing an IdP no longer
means editing a unit file and restarting — and an instance can offer more than
one.

Presets fill in the fiddly parts for Authentik, Keycloak, Microsoft Entra ID,
Okta, ZITADEL, Google Workspace and GitHub; **Custom OpenID Connect** takes any
provider with a discovery document, or explicit endpoints when it has none.

**Redirect URI to register at the IdP:**
`https://panel.example.com/api/auth/callback/<provider-id>`

The form shows it for the slug you type. It is better-auth's core
`/callback/:id` route, not the generic-OAuth plugin's own
`/oauth2/callback/:id` — `genericOAuth` registers each provider as a *social*
provider. The slug is part of that URI, which is why it cannot be renamed once
the provider exists.

### What a provider decides

| Field | What it does |
| --- | --- |
| Allowed email domains | Only these domains may sign in through it. Empty admits any the IdP authenticates. Matched on the exact domain — `notexample.com` is not `example.com`. |
| New users join / as | The organization a user the IdP provisions lands in, and the role they start with. |
| Group claim | Which claim carries group names (`groups` for most; ZITADEL uses a namespaced one). |
| Group → role | `platform-admins = admin`, one per line. The **highest** matched role wins, and names match case-insensitively. |
| Re-apply on every sign-in | Removing someone from a group in the IdP demotes them here too. Off by default, because it also overrides a role an owner set by hand. |

The allow-list is a standing rule, not a one-off admission check: a user whose
domain is removed from it stops being able to sign in, not merely being
creatable.

### Requiring it

**Settings → Organization → General → Security** has *Require single sign-on*,
per organization. Members who did not arrive through an IdP are shown an
interstitial offering it, and are blocked from every org-scoped procedure and
WebSocket until they do.

Two things keep that from becoming a support ticket:

- **Instance admins are exempt.** They are the way back in when the IdP is down
  or misconfigured. Gating them would mean nobody could turn the switch off.
- **The switch refuses to lock you out.** It cannot be enabled unless at least
  one admin or owner of the organization already has a linked SSO identity (or
  is an instance admin). The panel disables the switch with the reason attached
  rather than letting you discover the guard by hitting it. Removing the last
  provider while an organization still requires SSO is refused for the same
  reason.

### Migrating from the environment variables

`NIXPLOY_OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_PROVIDER_NAME` /
`_DEFAULT_ORG` still work: on first boot after upgrading they are imported into
a provider row with the slug `oidc`, so existing redirect URIs keep working and
nobody has to do anything. The import happens **once** — after that the row is
authoritative, and stale variables left in the environment cannot overwrite an
edit made in the panel. They can be deleted at your convenience.

### How a change takes effect

better-auth freezes its plugin array at construction, so saving a provider
rebuilds the auth instance rather than waiting for a restart. In a `panel` /
`worker` split the mutation also NOTIFYs on `nixploy_auth_rebuild` and the
other process rebuilds too. Sessions live in Postgres, so nobody is signed out;
what a rebuild does reset is better-auth's in-memory rate-limit counters, which
is why this is on a mutation and not a timer.

### Group and role plumbing

Groups are read from the **ID token better-auth stored**, not from the OAuth
profile: `mapProfileToUser` does not run for a user who already exists, so it
cannot drive anything that must happen on every sign-in. The token was already
verified against the provider's JWKS before it was written; reading it back is
reading our own row.

## Instance user management

Settings → Platform → **Users** (instance admin only) lists every account over
the better-auth `admin()` plugin: instance role (`user` / `admin`), 2FA state,
ban state, ban/unban, and impersonation. Impersonated sessions last **one
hour** (`impersonationSessionDuration`) and every action is audited
(`admin.user.banned`, `admin.user.role.set`, `auth.impersonation.started`, …).
Clearing someone's TOTP is not a plugin capability — use
`scripts/reset-admin.mjs` above.

## Auth events in the audit log

better-auth `hooks.after` writes these into the organization audit trail, with
the client IP and user agent in `metadata` (the audit table has no columns for
them — see [status.md](./status.md)):

`auth.login` (with `method: password | sso`), `auth.login.failed`,
`auth.login.locked`, `auth.logout`, `auth.password.changed`,
`auth.2fa.enabled` / `auth.2fa.disabled`, `auth.apikey.created` /
`auth.apikey.deleted`, `auth.impersonation.started` /
`auth.impersonation.stopped`, `admin.user.banned` / `admin.user.unbanned` /
`admin.user.role.set` / `admin.user.removed` / `admin.user.password.set`.

Rows are attributed to the actor's oldest organization membership.
`audit_log.organization_id` is **nullable** since migration `0025`, so an
instance-level event (a failed login for an account that belongs to no
organization) is representable; `recordAuthEvent` still resolves a membership
first, so wiring org-less events through it is a follow-up.

The table has `ip` and `user_agent` columns of its own (migration `0025`);
`auditFromSession` fills them from the request headers, honouring
`TRUSTED_PROXIES` and the socket-peer check, so a forged `X-Forwarded-For`
never lands in the trail. The auth hooks still write them into `metadata`.

Deleting an organization no longer erases its trail: the FK is
`ON DELETE SET NULL` and `organization_name` keeps a readable label.

### Retention, export and forwarding

- Retention: `NIXPLOY_AUDIT_RETENTION_DAYS` (default 365, `0` = forever),
  enforced by the hourly maintenance cron.
- Export: `audit.export` returns the org's trail as CSV
  (`{ filename, rows, csv }`), same `audit.read` gate as `audit.all`.
- Forwarding: `NIXPLOY_AUDIT_FORWARD=1` mirrors every new row to the
  instance-admin notification channels, batched once a minute (max 50 rows per
  message, the rest summarised as "…and N more"). Use it when the trail must
  survive a compromised instance admin — the panel can delete its own table,
  it cannot delete a Slack message.

## Encryption key rotation

`ENCRYPTION_KEYS` is a comma-separated list: **the first entry encrypts, every
entry can decrypt**. `ENCRYPTION_KEY` remains the single-key form and is used
when `ENCRYPTION_KEYS` is unset. That is what makes a rotation possible without
downtime:

```sh
# 1. generate the new key
openssl rand -hex 32

# 2. /etc/nixploy/.env — NEW key first, current key second
ENCRYPTION_KEYS=<new>,<current>

# 3. restart the panel so it reads both
docker service update --force nixploy

# 4. rewrite every secret column with the new key
docker exec nixploy pnpm -F @nixploy/server nixploy:rotate-key
#   --dry-run             report what would change, write nothing
#   --batch-size=500      rows per transaction (default 500)
#   --table=notification  one table only
#   --skip-undecryptable  leave rows no configured key can read (a lost key)

# 5. /etc/nixploy/.env — drop the old key, restart again
ENCRYPTION_KEYS=<new>
```

The script discovers the columns from the Drizzle schema (every
`encryptedText` / `encryptedJson` column — 47 of them across 20 tables today),
so a new secret column needs no change to it. Each batch is one transaction; a
row that no configured key can authenticate aborts the run and names the table,
column and row id.

Keys may also be passphrases of 32+ characters. Those are stretched with
**scrypt** and written with a `v2:` prefix; 64-char hex keys keep writing `v1:`
(there is no KDF to strengthen). Both versions are readable forever, so
switching a passphrase install to a hex key is just another rotation.

The panel **refuses to boot** on the placeholder keys from
`apps/web/.env.example` (`change-me-…`) or a single repeated character
(`assertEncryptionKeyLooksReal`, run at module load).

## Outbound requests (egress policy)

User-configured endpoints — notification webhooks, SMTP, Gotify/ntfy/Mattermost,
self-hosted Gitea/GitLab, S3 destinations, uptime probes, git clone URLs — all
go through `utils/public-url.ts`:

- cloud metadata, link-local, multicast, benchmarking and documentation ranges
  are **never** reachable, on any setting;
- the Swarm overlay (`10.0.0.0/8`) is never reachable as an **IP literal** —
  only through a bare service name the organization deployed;
- `nixploy`, `nixploy-postgres`, `nixploy-traefik`, `traefik` and `postgres` are
  never reachable by name;
- other private/LAN addresses (127/8, 192.168/16, 172.16/12, CGNAT, IPv6 ULA)
  need the instance-admin toggle **Settings → Platform → Outbound requests →
  Allow private network targets** (`web_server_settings.allow_private_egress`,
  default **off**; `NIXPLOY_ALLOW_PRIVATE_EGRESS=1` forces it on for installs
  without UI access).

Turning the toggle on lets organization **admins** — not just the instance
admin — point notification, SMTP, registry and S3 targets at hosts on the
panel machine's LAN, so it is worth the extra click only for a self-hosted
MinIO, Gotify, Gitea or SMTP server. The ranges in the first three bullets stay
blocked either way. The guard caches the flag for 30 s; saving the toggle
invalidates that cache, so the next outbound check sees the new value
immediately.

Once a target passes, the connection is **pinned to the address that was
vetted** (`pinnedFetch` — a `node:http`/`node:https` request with a custom
`lookup`), so a 0-TTL name cannot be re-pointed between the check and the
connect. nodemailer, git and the AWS SDK resolve on their own, so those paths
re-resolve and compare instead (`assertAddressesUnchanged`).



## API keys (REST & CLI)

Keys are **scoped** and **organization-bound** — a key is no longer the owner's
whole identity:

| Scope | Capability ceiling |
| --- | --- |
| `read` | `audit.read`, `secrets.read` + every list/read procedure |
| `deploy` | read + `service.deploy`, `service.runtime` |
| `write` | deploy + `service.write`, `domains.manage`, `secrets.write` |
| `admin` | the owner's full set |

The effective set is **scope ∩ the owner's own capabilities**, applied as a
per-request ceiling in `lib/api-key-context.ts` and entered by
`protectedProcedure` (`trpc/init.ts`), so `assertCapability` in every router
sees the reduced set without any router change. The deploy webhook
(`/api/webhooks/deploy/<appName>`) goes through the same path, which also gives
it the org 2FA gate.

Vocabulary and helpers: `modules/auth/api-key-scopes.ts`. The canonical column
is `apikey.permissions`; because the api-key plugin treats it as a server-only
property, the panel records the scope in `apikey.metadata` and `lib/auth.ts`
mirrors it into `permissions` right after creation. Both are read back.

Organization binding lives in `apikey.metadata.organizationId`. A bound key
refuses any other organization, including a contradicting `x-organization-id`.

Defaults on creation: **90-day expiry** (7/30/90 days and 1 year in the picker,
1 year maximum; "Never" for instance admins only) and the **`nxp_`** prefix so
secret scanners catch a leaked key. The panel shows **Last used**.

Keys created before scopes existed have neither column; they keep the old
behaviour and are labelled **Legacy — full access** in the panel. Rotate them.

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
tokens) use the `encryptedText` / `encryptedJson` column helpers
(`packages/server/src/db/custom-columns.ts`), AES-256-GCM with `ENCRYPTION_KEY`
(or the first entry of `ENCRYPTION_KEYS`). Losing that key makes stored secrets
unreadable — back it up with the same care as the database, and see
[Encryption key rotation](#encryption-key-rotation) for replacing it.

Production install (`install.sh`) writes `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`,
Postgres password and `BETTER_AUTH_URL` to `/etc/nixploy/.env`.

## Runtime isolation

Identity is only half of the story: what a tenant's *container* can reach is
covered in [hardening.md](./hardening.md) — the per-environment overlay, the
tenant-free `nixploy-internal` network for panel ↔ Postgres, the baseline
container defaults (`CapabilityDrop: ALL`, `no-new-privileges`, pids/ulimit
caps, log rotation, quota-derived CPU/memory limits) and the opt-in database
external ports.
