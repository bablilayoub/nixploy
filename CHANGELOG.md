# Changelog

All notable changes to Nixploy. Kept by hand — the repository takes direct
commits, so auto-generated "what's changed" lists come out empty.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions are the release tags (`vX.Y.Z`) that `install.sh` and `update.sh`
pin. Operator-facing detail — what to check before upgrading, what will look
different afterwards — lives in [docs/upgrade-notes.md](docs/upgrade-notes.md);
this file is the summary.

## [Unreleased]

Nothing yet.

## [0.2.0] — 2026-09-12

First release after the stability sweep and the September improvement audit.
**It changes defaults.** Read
[docs/upgrade-notes.md → v0.2.0](docs/upgrade-notes.md#v020) before upgrading —
in particular org quotas becoming real limits, cross-environment DNS going
away, and `ping` no longer working inside tenant containers.

### Added

- Health endpoints: `GET /api/health`, `GET /api/ready`, `GET /api/version`.
  The image `HEALTHCHECK` and both scripts probe `/api/ready`, so a half-dead
  panel fails its rollout instead of passing.
- Platform self-alerts every 5 minutes: host disk (85 % / 95 %), oldest queued
  deployment (> 30 min), ACME certificate expiry (< 14 days), platform
  services below their desired replicas, and "no instance backup in N days"
  (`NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS`, default 8). Surfaced in `/api/ready`
  and on Monitoring → Fleet; sent to instance-admin notification channels with
  a 24 h cooldown.
- Opt-in weekly Docker cleanup cron (`NIXPLOY_DOCKER_CLEANUP_CRON`).
- Per-environment overlay networks and a tenant-free `nixploy-internal`
  overlay for the panel and Postgres.
- Traefik middleware layer (rate limit, basic auth, IP allowlist, headers,
  compression) and DNS-01 wildcard certificates.
- Backup run history, a `local` destination provider and restore verification.
- `tools/dr-restore-test.sh` — rehearses a restore into a scratch Postgres
  container and, with `--boot`, boots the panel against it.
- `uninstall.sh` — removes the platform services and overlays; `--purge` also
  deletes the volume and config directory after a typed confirmation.
- Installer preflight: ports 80/443, disk, memory, rootless Docker, and a
  DNS-vs-public-IP check before Let's Encrypt, plus firewall one-liners in the
  summary.
- Offline / air-gapped install recipe, `docs/troubleshooting.md`,
  `docs/upgrade-notes.md`, a complete runtime-environment reference in
  `docs/install.md`, a "Platform logs" section in `docs/observability.md`.
- `tools/dev.sh` and `.nvmrc` for a one-command local stack.
- Graceful shutdown (SIGTERM drains the deploy queue), a pre-upgrade
  `pg_dump`, a downgrade guard, and a real `queued` deployment status.
- `tzdata` in the image, so `TZ` actually changes the timezone every cron runs
  in.
- Scoped, organization-bound API keys (`nxp_` prefix, 90-day default expiry),
  a first-admin setup token printed by the installer, and SSO through OpenID
  Connect (`NIXPLOY_OIDC_*`).
- Deploy provenance (commit, author, trigger) with pre-flight checks and
  queue supersede; pre/post-deploy hooks; preview knobs (env, cap, TTL, fork
  approval) with commit metadata; pull-request previews for compose services;
  remote-server builders and optional registry push; incident ack/resolve; a
  public status page; docker-image auto-update.
- Process roles: `NIXPLOY_ROLE=panel|worker` with `install.sh --split-worker`
  (a `nixploy-worker` service takes the deploy queue, crons and Traefik
  provisioning, coordinated over Postgres LISTEN/NOTIFY) and a `/ws/events`
  push stream that replaces dashboard polling.
- Pooled SSH transport to managed servers (keepalive, bounded channels, a
  per-server circuit breaker exposed as `server.transportState`) and bounded
  fan-out in the crons.
- TCP/UDP routing through Traefik: instance-level entrypoints (Settings →
  Server) and `protocol` / `tlsMode` on domains (HostSNI, terminate or
  passthrough).
- Databases: a curated engine version picker (downgrades blocked, major
  upgrades confirmed) and additional logical databases/users per instance.
- Compose rollbacks from per-deploy snapshots, `compose.createFromUrl`, and
  organization template sources (`http-json` / `git`) merged into the catalog.
- Updater release notes and a version pin (`pinnedVersion`,
  `runUpdate({ version, allowDowngrade })`).
- Image schedules (`runMode: image`) and "Run once" jobs under the container
  hardening baseline.
- Prometheus exposition at `GET /api/metrics` (API key) and
  `NIXPLOY_METRICS_RETENTION_HOURS`.
- Server SSH web terminal and a volume file browser (instance admin, audited,
  path-confined).
- Security: address-pinned egress with an instance `allowPrivateEgress`
  toggle, `ENCRYPTION_KEYS` rotation with `nixploy:rotate-key`, build secrets
  off argv (env files, BuildKit secrets), streaming database dumps to S3, audit
  rows with IP / user agent, CSV export and optional forwarding, and rate
  limits that trust forwarded headers only from a trusted socket peer.
- CLI: registry-driven commands, `org list/use`, `audit list --since`,
  `audit export`, 429 handling; MCP with 32 tools; every procedure documented
  in OpenAPI (390 across 44 routers) and the landing API catalog generated
  from it.
- CI: a real end-to-end job on a Swarm, a UI golden path, cosign-signed
  images, SHA-pinned actions, installer checksums (`SHA256SUMS`), knip and
  Biome warnings as errors.

### Changed

- **No global HTTP → HTTPS redirect** in the static Traefik config — it
  overrode every domain's own `https` toggle. Domains with HTTPS on keep
  redirecting through a per-router `redirectScheme` middleware; a domain with
  HTTPS off is served plain on `:80`. `update.sh` migrates existing installs.
- **Org quotas `maxCpuShares` / `maxMemoryMb` are applied as per-service
  resource limits** when a service sets none.
- **Instance dumps use `pg_dump --clean --if-exists`**, so they restore over a
  database the panel already migrated; the restore procedure is reordered to
  match.
- Container hardening on every tenant container: `CapabilityDrop: ALL` plus a
  seven-cap add-set, `NoNewPrivileges`, `pids_limit` 1024, `nofile` 65536,
  rotating json-file logs.
- Builders receive **only** `buildArgs`; runtime env is no longer merged into
  the build environment (`NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` restores it).
- Commands time out after 30 minutes, deployments after 60.
- The dashboard catch-all router is dropped once a dashboard domain is
  configured — the panel then answers on that host only.
- `install.sh` / `update.sh` forward **every** documented runtime knob when it
  is set, so it survives later updates.
- New installs give `nixploy-postgres` a `pg_isready` healthcheck, rotated
  logs and a 60 s stop grace; existing installs opt in with
  `NIXPLOY_UPDATE_POSTGRES_SPEC=1`.
- Compose files are rendered before validation, and the deny-list grew
  (`cgroup_parent`, oversized `tmpfs`, foreign log drivers, `deploy.mode:
  global`, manager-targeting placement, …).
- Instance backups, Swarm joins, the manager role, wildcard domains,
  `networkSwarm` overrides and host-privileged `compose.update` are
  instance-admin only.
- Unified service pages: one header, one tab order and one status badge across
  applications, compose and the five database kinds.
- API keys are minted with the `nxp_` prefix and expire after 90 days by
  default; existing keys keep working.
- Audit log: `organization_id` is nullable (history survives an
  organization's deletion) and rows carry `ip`, `user_agent` and
  `organization_name`; auth events write those as columns, not `metadata`.
- LAN targets for notifications, SMTP, registries and S3 need the instance
  toggle Settings → Server → "Outbound requests" (default off).
- Changing Traefik entrypoints restarts the proxy (about nine seconds of no
  routing); the static config is regenerated from the entrypoint table.

### Removed

- **`.env` is no longer included in instance backups** — shipping
  `ENCRYPTION_KEY` next to the dump it protects handed every tenant credential
  to whoever could read the bucket. Keep your own copy.
- Six dead tRPC procedures. The one with callers in the wild:
  `application.saveDockerProvider` → use `application.saveSource`
  (`{ sourceType: "docker", dockerImage }`).
- `NET_RAW` from tenant containers — `ping` inside a container and Uptime Kuma
  ICMP monitors no longer work (HTTP/TCP monitors are unaffected).
- Cross-environment and cross-organisation service DNS.

### Fixed

- HTTPS domains using the default certificate never routed.
- A deploy no longer wipes a domain's Traefik middleware chain.
- Boot recovery re-enqueues `queued` deployments and fails leftover `running`
  ones instead of leaving them hanging.
- Every compose domain routed to a nonexistent upstream name
  (`<app>-<svc>-<svc>-1`) and answered 502.
- A deployment was marked done before any task ran; it now waits for a
  running task and fails with the engine's reason when tasks keep failing.
- A queued backlog found at boot sat until the first request touched the
  deploy engine.
- Duplicate host or app names leaked the raw SQL statement to the client.
- Throttled API keys answered 401 instead of 429 with `Retry-After`.
- A stale session cookie looped between `/login` and `/dashboard`.
- The projects dashboard stayed on its empty state after the first project
  until a reload.
- Multi-arch images were listed once per platform under Docker → Images.

## [0.1.0]

Initial public release: projects, environments, applications, compose stacks,
five managed database engines, Git and Docker sources, Traefik routing with
Let's Encrypt, backups, schedules, notifications, monitoring, the REST/OpenAPI
adapter, the MCP endpoint and the published CLI.
