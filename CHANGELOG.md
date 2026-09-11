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

## [0.2.0] — unreleased

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

## [0.1.0]

Initial public release: projects, environments, applications, compose stacks,
five managed database engines, Git and Docker sources, Traefik routing with
Let's Encrypt, backups, schedules, notifications, monitoring, the REST/OpenAPI
adapter, the MCP endpoint and the published CLI.
