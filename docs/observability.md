# Observability

## Live streams (WebSocket)

`/ws/logs` (container logs), `/ws/deployment` (build/deploy logs),
`/ws/stats` (per-second container stats), `/ws/terminal` (interactive exec).
All rendered by `apps/web/src/components/services/log-viewer.tsx` (shared by
apps, databases, compose, deployment dialogs and the Docker tab) and
`monitoring-charts.tsx`.

The LogViewer classifies every line into a level shown as a gutter badge:
`ERR` / `WRN` / `OK` / `INF` / `DBG` (see `classifyLine` — explicit `[tag]`
prefixes first, then common Docker/Postgres/buildkit tokens). Timestamps are
dimmed. Toolbar: text filter, level toggle chips, wrap, follow, clear, and
download-as-`.txt`.

## Metrics history

- Cron `metrics-history` (every 30s, `modules/monitoring/history.ts`)
  snapshots cpu/memory/network/block-io/pids for every **local**
  application, compose (first container) and database into
  `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`, pruned to 48h.
- Services hosted on **managed servers** are sampled in the same pass: one
  SSH batch per active server collects host cpu (`/proc/stat` delta), memory
  (`/proc/meminfo`) and disk (`df`) plus a one-shot `docker stats` per
  service container (`modules/monitoring/remote.ts`). Service samples land
  in the same `<appName>.jsonl` files, so the Monitoring tab history and
  24h uptime chip work for remote services too; host-level samples go to
  `server-<serverId>.jsonl` and are exposed via
  `monitoring.serverHistory { serverId, hours }`.
  Per-server opt-out / cadence: `server.metricsConfig.metrics`
  (`enabled`, `intervalSeconds`), editable on the server edit dialog
  (Settings → Servers). An unreachable server is skipped per pass — local
  sampling is never affected.
- `monitoring.history { appName, hours }` returns the window downsampled to
  ≤240 points; the Monitoring tab's range picker (Live / 1h / 6h / 24h /
  48h) switches between the live `/ws/stats` feed and history (network and
  disk rates are computed from consecutive cumulative deltas).
- The Monitoring header shows a 24h uptime chip (share of 30s slots with
  samples), and a "Service is not running" empty state
  with Retry when the live stats socket reports no container — no more
  infinite "Connecting…" for stopped services.
- KPI cards: CPU, memory, network in/out, disk I/O and process count, each
  with a sparkline or meter. Charts share a synced cursor (`syncId`) and
  draw dashed peak markers; services with multiple replicas get a
  per-replica breakdown (`monitoring.replicaStats`).

Sampling runs four services at a time locally and every managed server in
parallel; the remote timeout scales with the number of services (15 s + 3 s
per service, clamped to 25–180 s). A stopped service at the end of the SSH
batch no longer discards the whole pass.

Alert rules on `restarts` count the running container's RestartCount plus
Swarm tasks that exited non-zero in the last hour (Swarm replaces tasks
rather than restarting in place); `deploy_failure_streak` counts consecutive
failed deployments. Both are only computed while an enabled rule references
them.

## Threshold alerts

- Org-level CPU/memory thresholds live in Settings → Platform → Host health
  (`webServerSettings.metricsConfig.webServer.{cpuAlertPercent,
  memoryAlertPercent}` — empty = disabled).
- The metrics-history pass keeps a rolling 5-sample window (~2.5 min) per
  service; a sustained average above a threshold fires a
  `serverThreshold` notification, once per 30 min per service + metric
  (`evaluateAlerts` in `modules/monitoring/history.ts`). Local and
  remote-hosted services alike (remote samples arrive over the SSH batch).

## Notification events

Settings → Notifications subscribes a channel to individual events. Every
toggle is wired to a real emitter:

| Event | Fired by |
| --- | --- |
| `appDeploy` / `appBuildError` | every terminal application and compose deploy (`emitDeployNotification`, cancellations stay silent); `appBuildError` also carries the failure watchdog's "service down" transition |
| `databaseBackup` | database and named-volume backup runs, scheduled or manual (`emitBackupNotification`) |
| `serverThreshold` | sustained CPU/memory above the host-health thresholds (see above) |
| `serviceAlert` | an alert rule crossing its threshold |
| `uptimeFlip` | an uptime probe changing state, plus the incident it opens |
| `dockerCleanup` | the Docker control center prunes (images / volumes / system) and Settings → Platform → "Clean up now" (`emitDockerCleanupNotification`) |
| `nixployRestart` | the panel process finishing boot, once per start (`emitInstanceRestartNotification`, called from `apps/web/server.ts`) |

## Status reconciler & watchdog

- Cron `status-reconciler` (every 60s, `modules/deployment/reconciler.ts`)
  compares each service's stored status with real Swarm/container state and
  corrects drift (`error → running` when tasks are healthy, `running/done →
  idle` when scaled to zero, anything → `error` on crash loops). Services
  with an in-flight deployment are skipped.
- Transitions INTO `error` fire the **failure watchdog**: an `appBuildError`
  fan-out to the org's notification channels (Slack/Discord/Telegram/email/
  Gotify/Ntfy/Pushover/Mattermost/Lark/Teams/custom — enable the event toggle
  on the channel).
  Deploy success/failure notifications come separately from the deploy
  worker (`modules/deployment/events.ts`).

## Platform health endpoints

Three unauthenticated routes describe the panel itself (never tenant data,
never configuration). All answer `cache-control: no-store`.

| Route | Purpose | Status |
| --- | --- | --- |
| `GET /api/health` | Liveness — the process serves HTTP. `{ ok: true, uptimeSeconds }` | always 200 |
| `GET /api/ready` | Readiness — per-check report (below) | 200, or **503** with `failing: [...]` |
| `GET /api/version` | `{ version, commit?, node, nextjs }` for `nixploy doctor` and support | 200 |

`/api/ready` (logic in `packages/server/src/modules/observability/health.ts`,
results cached 5 s so Swarm, `update.sh` and dashboards polling together cost
one pass; every probe is bounded to 4 s):

| Check | What | Fails readiness? |
| --- | --- | --- |
| `database` | `SELECT 1` through the pool | yes |
| `docker` | `docker.ping()` on the host socket | yes |
| `migrations` | journal shipped with the build vs `drizzle.__drizzle_migrations` (`state`: `current` / `behind` / `ahead` / `unknown`, plus `applied` / `expected` counts) | `behind` only — `ahead` (old code on a newer schema, i.e. a downgrade) and `unknown` are warnings |
| `queue` | in-memory deploy queue (`pending` / `running`) and rows still `running` after 90 min (`stuck`) | never — warning only |
| `traefik` | `nixploy-traefik` Swarm service present (`docker service ls`, cached 10 s) | only when the panel bootstraps Traefik itself (`NIXPLOY_DISABLE_TRAEFIK_BOOT` unset); the production image sets it, so there a missing proxy is a warning |

Consumers: the image `HEALTHCHECK` (Swarm restarts a task that stays 503 and
`--update-failure-action rollback` reverts a bad update), the post-roll
probes in `install.sh` / `update.sh`, and `nixploy doctor`, which prints the
report next to the server/CLI versions and warns on a major-version mismatch.

## Cron schedules run in UTC

Every cron expression in the panel — database and volume backups,
schedules, the update checker — runs in the process time zone, which is UTC
in the production image (Alpine, no `TZ`). `0 3 * * *` is 03:00 UTC, not
local time; the inputs are labelled accordingly.

## Retention

The hourly maintenance cron (`modules/deployment/maintenance.ts`, `7 * * * *`):

- deletes `deployment` rows older than 30 days beyond the newest 50 per
  application / compose / schedule, together with their `.log` and
  `.explain.json` files (rows still `running` or referenced by a rollback
  snapshot are kept);
- removes orphaned or > 30-day-old build logs under `<config>/logs` (one
  anti-join per directory, the table is never loaded into memory);
- removes schedule run output under `<config>/schedules` older than 30 days;
- drops incidents resolved more than 90 days ago or older than 180 days;
- drops `audit_log` rows older than `NIXPLOY_AUDIT_RETENTION_DAYS` (default
  `365`; `0` keeps them forever).

## Healthchecks

Applications → Advanced → Healthcheck writes a Docker `Healthcheck`
(`healthCheckSwarm` jsonb column) onto the swarm service: an HTTP probe
against `127.0.0.1:<port><path>` inside the container with configurable
interval/timeout/retries/start-period. The image must contain `curl` or
`wget` — otherwise the probe itself fails and Docker keeps restarting the
container as unhealthy (the reconciler will surface it as `error`).
