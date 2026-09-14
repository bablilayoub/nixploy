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

## [0.2.8] — 2026-09-15

### Added

- **Inherited variables are visible from the service.** The Environment tab of
  every application, compose stack and database lists what it gets from the
  organization, the project and the environment, marks the ones the service
  overrides, and links to the chain. Until now that whole layer was invisible
  from where it matters.
- The service header says when it was last deployed and by whom.
- Deployment logs get an **errors-only filter** (one click from a thousand-line
  build to the line that failed) and a copy button.
- Docker sub-tabs are deep-linkable (`?tab=volumes`) and survive a refresh.
- The API smoke test can build an app **from source** (`SMOKE_BUILD_REPO` /
  `SMOKE_BUILD_TYPE`) and CI now does. Every other step deploys a prebuilt
  image, which is exactly why the v0.2.7 buildx breakage passed CI and broke
  every real build. ~45 s.
- An incident that names a service links to it — deploy-failure incidents now
  record which kind of service failed, which is what makes the link possible.
- **Creating an application asks for its source.** The dialog takes a Docker
  image or a repository URL (or "set up later"), saves it with the service and
  opens the new service page — a new app used to land in the list unusable
  until you found two more forms on two more tabs.
- **The add-domain dialog checks DNS while you type**: whether the host
  resolves, where to, and this server's public IP, so a mispointed A record is
  visible before saving instead of after the certificate fails. New
  `domain.checkDns` procedure.
- Saving environment variables says they apply on the next deployment and
  offers a Deploy button in the toast; the editor footer says the same.
- The panel shows a service's public address where you look for it: under the
  service title (with a copy button and a link that opens the site) and in the
  project's services table. It used to live only in the Domains tab.
- Dashboard project rows carry a health summary — how many services are
  failing, how many are running — instead of only a service count.
- A dismissible "Finish setting up" checklist on the dashboard with five live
  checks (panel domain with TLS, git provider, first service, first successful
  deployment, first domain), each linking to the page that does it.
- A service that cannot be deployed yet says why under its title ("Set a
  repository URL or Docker image first"). The reason used to be a tooltip on
  the disabled Deploy button.

### Changed

- Page descriptions wrap instead of being truncated — the Servers page cut its
  own instructions mid-word, with no way to read the rest.
- Cards no longer repeat the page title: "Organization" → "Name" (with a note
  on why the slug is fixed), "Profile" → "Name and avatar", the Servers card →
  "Connected hosts".
- Platform → Access saves the Let's Encrypt email from a button next to the
  field rather than one in the card header, which sat next to the domain it did
  not save.
- The empty schedules and project-services states say what the thing is for and
  offer a way in ("Browse templates").
- The rollbacks table's "Version" column is called "Image tag" — it is the
  local tag the image is pinned under, not a release number.
- A service page that cannot load is no longer a dead end: it names what is
  missing, links back to the project, and only offers Retry when retrying
  could work (a deleted service used to show a Retry button that could not
  succeed, and no way back).
- The add-domain dialog hides the certificate picker unless something actually
  terminates TLS, and clears the choice when HTTPS is switched off.
- Monitoring leads with the fleet: the Prometheus endpoint card moved below it
  instead of pushing the service list and its charts off the screen.
- The backups empty state carries an "Add backup storage" button instead of
  naming the settings page in prose.
- **Redeploy is gone from the application and compose headers.** It queued
  exactly the same job as Deploy — same builder, same rollout — under a second
  name, so the two buttons only suggested a difference that was not there. The
  `application.redeploy` / `compose.redeploy` API procedures are unchanged.
- Deployment status reads the same everywhere: a failed deployment is
  "Failed", not "Error" in one place and "Failed" in another, and the badge
  colours match the dashboard's dots (blue while running, green when
  succeeded).
- Long tables and tab strips show a shadow at the edge they can scroll toward,
  and the tab strip's own scrollbar (which sat on top of the active underline)
  is hidden.
- Phones: the settings menu is a select instead of twelve stacked links that
  pushed every settings page off the screen; the deployments table folds its
  Created and Duration columns under the title; the project toolbar wraps
  instead of pushing "Add service" past the right edge.
- The deployments chart says "No deployments in the last 14 days" instead of
  drawing an empty grid.

### Fixed

- **Dockerfile builds failed on a stock Docker install.** The per-app layer
  cache is on by default, and buildx's default `docker` driver cannot export
  one — the build died with "Cache export is not supported for the docker
  driver" instead of simply building without a cache. Docker Desktop hides
  this by shipping the containerd image store, which is why it never showed up
  in local testing. The build host is now probed for cache-export support, and
  a host without it builds anyway, with a log line saying how to get the cache
  back. Found by the new source-build smoke step on its first CI run.
- **Housekeeping never ran.** The hourly maintenance pass failed on every
  install: `pruneDeploymentRows` passed a JavaScript `Date` into a raw
  statement, which the Postgres driver refuses, so old deployment rows and
  their log files were never removed. Confirmed on a live instance (the step
  failed once an hour, every hour). The maintenance logger also swallowed the
  driver's reason, which is why the log only ever said "Failed query: …".
- The audit trail showed a raw uuid instead of the service name on every
  deploy row, and rendered its timestamps in 12-hour time while the rest of the
  panel uses 24-hour.
- Long Docker container, network and volume names ran across the neighbouring
  columns and pushed the rest of the row off the table; they truncate now, so
  the containers list fits without horizontal scrolling.
- The log viewer's errors-only filter hid the very line it exists to find:
  "Deployment failed: …" was not classified as an error because only "failed
  to" matched.
- Twelve middleware fields, two database credential fields, an alert threshold
  and the generated SSH key boxes had visible labels that were never associated
  with their control, so a screen reader announced an unnamed text box.
- Between roughly 850 and 1000 px the organization switcher overlapped the top
  navigation links.
- The "no instance backup" platform alert pointed at "Settings → Backups",
  which is not what that page is called.
- Every dashboard load logged a React hydration error: the recent-deployments
  subtitle rendered "Loading…" on the client while the server had already
  rendered the loaded text. Relative timestamps in the project list, project
  deployments table and schedules panel go through `<DateTime>` now, which is
  hydration-safe.
- The deployment log drawer kept saying "Running" after the deployment it was
  showing had finished.

## [0.2.7] — 2026-09-14

### Fixed

- Builds from source (nixpacks, railpack, Dockerfile) failed on every
  released install with "BuildKit is enabled but the buildx component is
  missing or broken": the image installed the docker CLI without the buildx
  plugin. It ships `docker-cli-buildx` now, and a host without the plugin
  falls back to the classic builder (no layer cache, no BuildKit secrets)
  with a log line saying how to install it, instead of failing the deploy.

## [0.2.6] — 2026-09-14

### Fixed

- The update dialog offered to pull an older image than the one running
  ("This pulls …:v0.2.1" on a v0.2.3 host): `update.sh` rolls the service
  without touching the panel's settings, so the tracked image went stale and
  confirming would have downgraded the instance onto a newer schema. Checks
  adopt the tag the service actually runs, the dialog shows the image that
  will really be pulled, and an update refuses an older release unless a
  downgrade is acknowledged.

## [0.2.5] — 2026-09-14

### Fixed

- Creating a GitHub App reported "No GitHub App installation found" and left
  a configured-looking provider that could not list repositories: the App
  had been created but not yet *installed* on an account. The panel now
  shows Installed / Not installed with an "Install on GitHub" button, and
  stores the installation automatically when GitHub sends you back.

## [0.2.4] — 2026-09-14

### Fixed

- The panel returned Traefik's `500 Internal Server Error` for every
  response with an empty body — the GitHub App callback redirect, empty
  404s, any 204. Traefik's buffering middleware (a 4 MiB request-body
  backstop in front of `/api/`) buffers responses too and fails on a
  bodyless one; it is gone, and the app's own payload caps stand. Existing
  installs pick up the new routing file the next time the dashboard domain
  is saved, or immediately after this update.
- `update.sh` / `install.sh` decide readiness from the new task itself
  (the same check the image HEALTHCHECK runs) before trying the proxy, so a
  working update is no longer reported as a failure when the panel is not
  reachable at `BETTER_AUTH_URL` from the host.

## [0.2.3] — 2026-09-14

### Fixed

- The in-app updater reported "up to date" on every installed release: it
  compared the digest of the tag the installer pinned (`:v0.2.1`) with
  itself. Version-tagged installs now follow GitHub's newest release (under
  the pin) and `Update` rolls to that tag; moving tags keep the digest check.

## [0.2.2] — 2026-09-14

### Fixed

- External connection URLs of databases on the Nixploy host showed
  `localhost`; they now use the host's public address (`NIXPLOY_PUBLIC_HOST`
  to override, detected public IPv4 otherwise).
- Renaming (or changing any single setting of) a database re-sent the
  default image and was refused as a version downgrade on newer instances —
  or silently reset the image. Partial updates leave the image alone.

## [0.2.1] — 2026-09-12

Follow-up to 0.2.0 after its release pipeline was exercised end to end.

### Fixed

- The runtime image ships `openssl`: when the panel provisions Traefik itself
  (compose stacks, dev in a container) it could not create the default TLS
  certificate and `/api/ready` stayed 503.
- MinIO template image moved to `quay.io/minio/minio` (Docker Hub no longer
  serves the tags).
- `tsx` is a dependency of `@nixploy/server` (key rotation script and the CI
  drift check ran `pnpm exec tsx` there).
- Image scan: the base image's bundled npm (with a vulnerable node-tar) is
  removed from the runtime image; the esbuild Go TLS finding is documented in
  `.trivyignore`.
- Release commits use a `[release]` marker; `[skip ci]` also skipped the tag
  push that was supposed to publish. The UI golden path resolves Playwright
  through `NODE_PATH`.
- Dependabot resolves pnpm 10 (`packageManager`) and ignores Node major image
  bumps.

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
