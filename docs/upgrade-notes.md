# Upgrade notes

Per-release, operator-visible behaviour changes: what to do before upgrading,
and what will look different afterwards. Bug fixes and internal work are in
[`CHANGELOG.md`](../CHANGELOG.md); this file only carries the things that can
surprise a running install.

Upgrade mechanics (rollback, pre-update dump, downgrade guard) are in
[install.md → Update](./install.md#update).

---

## v0.2.8

**Housekeeping starts deleting things — because it never ran before.** The
hourly maintenance pass has failed on every install since it was written: it
passed a JavaScript `Date` into a raw SQL statement, which the Postgres driver
refuses. Nothing was ever pruned. After upgrading, the first pass does the
backlog in one go:

- deployment rows beyond the newest 50 per service **and** older than 30 days,
- deployment and schedule log files older than 30 days,
- expired preview deployments, and incidents past their retention,
- audit rows older than `NIXPLOY_AUDIT_RETENTION_DAYS` (default 365; `0` keeps
  them forever) — the only one of these with a knob. The deployment and log
  thresholds are fixed in code today.

Rows referenced by a rollback pin are never deleted, and running or queued
deployments are never touched. An instance that has been running for months
will see one large delete in the first hour and nothing unusual after that. If
you need to keep an old build log, copy it out **before** upgrading.

**A build host that cannot export a layer cache now builds anyway.** Asking
buildx's default `docker` driver for `--cache-to type=local` fails the whole
build ("Cache export is not supported for the docker driver"), which is what
every Dockerfile build did on a stock Docker daemon. The panel probes the
build host and, when it cannot export a cache, builds without one and logs why
plus how to get it back (turn on the containerd image store, or create a
`docker-container` builder). Nothing to do unless you want the cache: builds
that already worked keep working, at the same speed.

**Redeploy is gone from the application and compose headers.** It queued
exactly the same job as Deploy — same builder, same rollout — so the two
buttons only implied a difference that did not exist. `application.redeploy`
and `compose.redeploy` are unchanged for API, CLI and webhook callers.

**Creating an application opens it.** The create dialog now asks for the
source (a Docker image or a repository) and lands on the new service instead
of returning to the list. Scripted UI flows that clicked the service in the
table afterwards should wait for the service URL instead.

---

## In-app updater: release notes and version pinning

**What "newer" means.** The installer pins the panel to the release tag it
installed (`NIXPLOY_IMAGE=ghcr.io/…/nixploy:v0.2.1`), and that tag never
changes. The checker therefore treats GitHub's newest release as the update
channel for version-tagged images: it offers the newest release under your
pin, compares its digest with the running container, and `Update` rolls to
that tag. A moving tag (`:latest`, `:main`) is its own channel — the digest
comparison alone decides.

Settings → Platform → Updates used to show a digest and nothing else — you
could see that *something* changed, not what, and could not choose which
version to roll to (product audit, Platform row "Updater shows digest only").

**Release notes.** Every update check resolves the GitHub release for the
image it tracks: the release for the tag when the image is pinned
(`…/nixploy:v1.2.3`), the newest release when it is a moving tag
(`:latest`). The body is fetched through the egress guard
(`assertPublicHttpsUrl` + `pinnedFetch`: https only, public addresses only, no
redirects, capped body), truncated to 16 kB **by bytes**, and cached with the
check so the dashboard poll never hits GitHub. A rate-limited, offline or
air-gapped instance simply shows no notes — release notes never fail a check.

**Update to a version.** `updates.runUpdate({ version })` accepts a plain
release (`1.2.3` / `v1.2.3`; pre-release suffixes are not accepted) and
replaces **only the tag** of the image the instance already tracks — the
registry and repository stay the ones it trusts, and the existing
`ghcr.io/bablilayoub/nixploy` allow-list still applies.

**Downgrades are gated.** Nixploy applies migrations on boot and never
reverses them, so an older image meets a newer schema. `runUpdate` refuses a
lower version unless you pass `allowDowngrade: true`; the UI asks first and
points at the pre-update dump, which is the actual way back. The contract is
unchanged from `update.sh`'s `NIXPLOY_ALLOW_DOWNGRADE` — see
[install.md → Downgrade](./install.md#downgrade) for the restore procedure.

**Pinning.** `pinnedVersion` in the update settings is a ceiling for
**automatic** updates: the checker logs "held back" instead of rolling past
it, and `runUpdate({ version })` refuses a target above it. Leave it empty to
follow the image tag wherever it goes. A pin does not stop a deliberate
update — raise or clear it first.

---

## v0.2.0

The first release after the stability sweep and the September improvement
audit. It changes several defaults. **Read "Before you upgrade" first.**

### Before you upgrade

1. **Check your org quotas.** `maxCpuShares` / `maxMemoryMb` used to be
   count-only guard rails. They are now applied as **per-service
   `Resources.Limits` defaults** for services that set none. A small value set
   "just in case" will cap every service in that org after the upgrade.
   Settings → Organization → Quotas. `1024` shares = 1 CPU.
2. **Check for cross-environment dependencies.** A service can now only
   resolve services of its **own environment**. If anything in `staging`
   talks to something in `production` by service name, it breaks.
3. **Check for ICMP monitors.** `NET_RAW` is dropped from tenant containers,
   so `ping` no longer works inside them. Uptime Kuma ICMP monitors stop
   reporting; HTTP/TCP monitors are unaffected.
4. **Back up `/etc/nixploy/.env` separately** if you have not already —
   instance backups now exclude it (see below).
5. `update.sh` takes a pre-update `pg_dump` automatically (keeps the last 3).
   Nothing to do, but that is your rollback point.

### Networking

- **Per-environment overlay networks.** Every environment gets its own
  overlay (`<env>-<id8>-net`); apps, databases and compose stacks join theirs.
  Cross-environment and cross-organisation DNS is gone by design.
- **`nixploy-network` is joined only while a service has a domain**, and is
  reconciled on every domain create/update/delete. A service with no domain
  is not on the shared overlay at all.
- **`nixploy-internal`**: the panel and Postgres move onto a tenant-free
  overlay and off the shared one, so no tenant container can resolve
  `nixploy:3000` or `nixploy-postgres:5432`. `install.sh` / `update.sh` run
  this migration idempotently on every run — **expect one extra panel restart
  on the first upgrade**. `DATABASE_URL` is unchanged.

### TLS and routing

- **No global HTTP → HTTPS redirect.** The entrypoint-level redirection is
  gone from the static Traefik config; it overrode every domain's own `https`
  toggle. Domains with HTTPS on keep redirecting (per-router `redirectScheme`
  middleware); a domain with HTTPS **off** is now served plain on `:80`, which
  is what the toggle was always supposed to mean. `update.sh` rewrites
  `traefik.yml` and restarts the proxy; a hand-managed install must delete the
  `http.redirections` block itself.
- **Traefik middleware layer.** Domains can attach rate-limit, basic-auth,
  IP-allowlist, header and compression middlewares. The chain is now loaded on
  every deploy, so a deploy no longer wipes it.
- **The dashboard catch-all is dropped once a dashboard domain is
  configured.** The panel then answers on its configured host only:
  `https://<server-ip>` returns Traefik's 404 instead of the panel. Clearing
  the domain restores the catch-all. Update your bookmarks.
- **Wildcard domains are instance-admin only** — there is no zone-ownership
  proof, and `*.example.com` would swallow every unclaimed subdomain on the
  instance.
- **`domain.create` with Let's Encrypt is capped at 20 per org per hour**
  (in-memory bucket, resets on restart).
- **DNS-01 wildcard certificates** are available (Settings → Platform →
  Wildcard certificates). Traefik reads the provider credentials from its own
  environment, so one manual step is required per install:
  `docker service update --env-add CF_DNS_API_TOKEN=… nixploy-traefik`. The
  settings card prints the exact command for the selected provider.

### Container hardening

Every tenant container now runs with `CapabilityDrop: ALL` plus a seven-cap
add-set, `NoNewPrivileges`, `pids_limit` 1024, `nofile` 65536 and rotating
json-file logs (10 MB × 3).

- Dropped: `NET_RAW` (no `ping`), `MKNOD`, `SETPCAP`, `AUDIT_WRITE` and the
  `SYS_*` family.
- `application.update` with a non-empty `networkSwarm` requires the instance
  admin role.
- Database `externalPort` rejects the panel's own port (3000 / `NIXPLOY_PORT`
  / `PORT`) and the Swarm data ports 4789/7946.
- Compose deny-list additions: `cgroup_parent`, unbounded/oversized `tmpfs`,
  a foreign `logging.driver`, `pids_limit` > 4096, `nofile` > 1M,
  `deploy.mode: global`, and `deploy.placement` targeting
  `node.role == manager`. A template using any of those now fails validation.

### Builds and deployments

- **Builders receive only `buildArgs`.** Runtime env vars are no longer
  merged into the build environment — a secret meant for runtime stopped
  leaking into image layers. Set `NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` to restore
  the old merge if a Dockerfile depended on it.
- **Local commands time out after 30 minutes** (`NIXPLOY_COMMAND_TIMEOUT_MS`)
  and **deployments after 60 minutes** (`NIXPLOY_DEPLOY_TIMEOUT_MS`). A wedged
  build now fails instead of holding a queue slot forever.
- `deployment.status` has a real `queued` value; queued rows are re-enqueued
  at boot and leftover `running` rows are failed.
- Graceful shutdown: SIGTERM stops dequeuing and waits
  `NIXPLOY_SHUTDOWN_GRACE_MS` (60 s) for in-flight jobs; the service has a
  90 s stop grace period.

### Backups and DR

- **`.env` is excluded from instance backups.** Shipping `ENCRYPTION_KEY` in
  the same bucket as the dump it protects handed every tenant credential to
  anyone who could read the bucket. **Keep your own copy of
  `/etc/nixploy/.env`** — a restore without the original `ENCRYPTION_KEY`
  cannot decrypt anything.
- **Instance dumps use `pg_dump --clean --if-exists`**, so a dump restores
  over a database the panel already migrated. The restore procedure in
  [instance-backup.md](./instance-backup.md) is reordered accordingly.
- `tools/dr-restore-test.sh` rehearses a restore into a scratch Postgres
  container (and, with `--boot`, boots the panel against it).
- Backup **run history** (`backup_run`), a `local` destination provider and
  restore **verification** are new.
- Instance backups are **instance-admin only** to create, edit, run or delete.

### Platform operations

- **Platform self-alerts** (every 5 min): host disk > 85 % / 95 %, oldest
  queued deployment > 30 min, an ACME certificate expiring in < 14 days,
  `nixploy-traefik` / `nixploy-postgres` below their desired replicas, and no
  successful instance backup in `NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS` days
  (default 8, `0` off). They go to notification channels with the **"Nixploy
  restarted"** toggle on, in organizations that have an instance-admin member
  — so existing subscribers of that toggle will start receiving them. One
  notification per alert per 24 h, surfaced in `GET /api/ready` and on
  Monitoring → Fleet.
- **Opt-in weekly Docker cleanup**: `NIXPLOY_DOCKER_CLEANUP_CRON` (unset =
  off) prunes dangling images and the BuildKit cache.
- **Health endpoints**: `GET /api/health`, `GET /api/ready`, `GET /api/version`.
  The image `HEALTHCHECK` and both scripts now probe `/api/ready`, so a
  half-dead panel fails its rollout instead of passing.
- **`TZ` works.** The image ships `tzdata`; set `TZ` and every cron runs in
  that zone (still UTC by default). Changing it *shifts existing schedules*.
- **Postgres service spec**: new installs get a `pg_isready` healthcheck,
  rotated logs and a 60 s stop grace. Existing installs opt in with
  `NIXPLOY_UPDATE_POSTGRES_SPEC=1 … update.sh` (it restarts Postgres once).
- **Installer preflight**: ports 80/443, disk, memory, rootless Docker, and a
  DNS-vs-public-IP check before Let's Encrypt. Escape hatches:
  `NIXPLOY_SKIP_PORT_CHECK=1`, `NIXPLOY_SKIP_DNS_CHECK=1`.
- **`uninstall.sh`** removes the three services and the overlays; `--purge`
  also deletes the volume and the config directory after a typed
  confirmation.
- **Every runtime knob is forwarded** by `install.sh` / `update.sh` when set
  (`NIXPLOY_DEPLOY_CONCURRENCY`, `NIXPLOY_WILDCARD_DOMAIN`, `DOCKER_SOCKET`,
  `NIXPLOY_BASE_URL`, `TZ`, …). See
  [install.md → Runtime environment](./install.md#runtime-environment). You no
  longer have to re-apply them with `docker service update --env-add` after
  every upgrade.
- **Offline install** is documented (`NIXPLOY_SKIP_DOCKER_INSTALL=1` +
  `NIXPLOY_PUBLIC_IP` + `docker save`/`load`).

### Permissions and API

- **Instance-admin gates**: Swarm joins and the manager role, `compose.update`
  on a host-privileged stack, wildcard domains, instance backups,
  `networkSwarm` overrides, self-update and the Docker cleanup trigger.
- **Six dead procedures were removed.** The one with a caller in the wild:
  `application.saveDockerProvider` → use `application.saveSource`
  (`{ sourceType: "docker", dockerImage }`). CLI and MCP users on an older
  client will see `Unknown procedure`.
- Secrets are redacted for viewers; redacted `env` / `composeFile` come back
  as `null`.

### Keys, egress, worker and layer-4 routing

- **API keys** are minted with the `nxp_` prefix and expire after 90 days by
  default. Keys created before v0.2.0 keep working; plan a rotation for
  automation that must not stop.
- **Outbound requests to private addresses** (notification webhooks, SMTP,
  registries, S3 on the LAN) are refused until the instance admin enables
  Settings → Server → "Outbound requests" (`NIXPLOY_ALLOW_PRIVATE_EGRESS=1`
  forces it). The Swarm overlay and cloud metadata stay blocked either way.
- **`ENCRYPTION_KEYS`** (optional) replaces the single `ENCRYPTION_KEY` for
  rotation: `"new,old"`, then `pnpm -F @nixploy/server nixploy:rotate-key`
  — see `docs/auth.md`.
- **Split worker** is opt-in: `NIXPLOY_SPLIT_WORKER=1 … update.sh` (or
  `install.sh --split-worker`) adds the `nixploy-worker` service and runs the
  panel as `NIXPLOY_ROLE=panel`. Single-process installs change nothing.
- **TCP/UDP entrypoints** publish extra host ports on `nixploy-traefik` and
  restart it (about nine seconds). Open the port in the host firewall as well.
- **Audit log**: `organization_id` is nullable and `ip` / `user_agent` are
  columns; anything reading `metadata->>'ip'` must switch. `audit.export`
  returns CSV; `NIXPLOY_AUDIT_FORWARD=1` mirrors rows to platform alerts.
- **`/api/metrics`** needs an API key; `NIXPLOY_METRICS_RETENTION_HOURS`
  (default 48) bounds the metrics store.
- **Rate limits** now trust forwarded headers only from a trusted socket peer;
  behind the installer's Traefik nothing changes.
- Migrations 0019–0028 run on update; the pre-update dump is the rollback.

### After upgrading

```bash
curl -sk https://<host>/api/ready | jq            # every check ok, platform warnings?
docker service inspect nixploy --format '{{json .Spec.TaskTemplate.Networks}}'
grep -A3 'address: ":80"' /etc/nixploy/traefik/traefik.yml   # no redirections block
```

Then redeploy anything that was mid-build during the roll.
