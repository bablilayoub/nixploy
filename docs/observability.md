# Observability

## Live streams (WebSocket)

`/ws/logs` (container logs), `/ws/deployment` (build/deploy logs),
`/ws/stats` (per-second container stats), `/ws/terminal` (interactive exec).
All rendered by `apps/web/src/components/services/log-viewer.tsx` (shared by
apps, databases, compose, deployment dialogs and the Docker tab) and
`monitoring-charts.tsx`.

`/ws/logs` follows a container **once per (container, tail)** and fans the
bytes out to every viewer, ref-counted (`ws/docker-logs.ts`, architecture
audit #20): three people watching one container is one `docker logs
--follow` — and, on a managed server, one SSH session — not three. A viewer
joining an existing stream replays what it captured so far (the `--tail N`
backfill plus everything since, capped at 2 MiB); the follow stops as soon
as its last viewer disconnects.

The LogViewer classifies every line into a level shown as a gutter badge:
`ERR` / `WRN` / `OK` / `INF` / `DBG` (see `classifyLine` — explicit `[tag]`
prefixes first, then common Docker/Postgres/buildkit tokens). Timestamps are
dimmed. Toolbar: text filter, level toggle chips, wrap, follow, clear, and
download-as-`.txt`.

## Metrics history

- Cron `metrics-history` (every 30s, `modules/monitoring/history.ts`)
  snapshots cpu/memory/network/block-io/pids for every **local**
  application, compose (first container) and database into
  `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`, kept to a 48h window.
- **Writes are appends** (`modules/monitoring/store.ts`). Each sample is one
  `appendFile` line; the file is rewritten — without the points that fell
  out of the window, through a temp file + `rename` so no reader sees a
  half-written file — at most **once an hour per file**. Before, every
  sample read, parsed, filtered and rewrote the whole file (~0.5 MB per
  service per 30 s at 48h retention; architecture audit #2).
- **Reads seek from the tail**: `monitoring.history` / `serverHistory` read
  a 64 KiB chunk from the end of the file and grow it (x4) only while the
  oldest line read is still inside the requested window; `latest` (one call
  per service in `fleetOverview`) is answered from an in-memory ring of the
  newest ~240 points per file. The ring is a pure cache — every point is on
  disk before it lands there, so nothing needs persisting at shutdown and a
  cold process refills it from the file tail on first read.
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

One pass costs a **fixed** number of Docker calls and DB queries, not a
multiple of the service count (architecture audit #3):

| Per pass | What |
| --- | --- |
| 1 `listContainers({ all: false })` | resolves every local service's container, indexed by `com.docker.swarm.service.name` / `com.docker.compose.project` / `com.docker.stack.namespace` |
| 1 `listContainers({ all: true, status: exited })` | crash-looped task containers for every service — only when an enabled rule watches `restarts` |
| 1 `environments.findMany(inArray(...))` | environment → organization/project for every target (was one `findFirst` per target) |
| 1 `loadEnabledAlertRules()` | every enabled alert rule, keyed by service (was one `alertRules.findMany` per target); services with no rule never reach the evaluator |
| 1 `stats({ stream: false })` per running container | the only per-service call left. Docker's `one-shot` is deliberately **not** used: it zeroes `precpu_stats`, so every service would report 0% CPU |

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
- One pass makes **two Docker API calls total** — `listServices()` +
  `listTasks()`, grouped by `ServiceID` in memory (`loadSwarmSnapshot`) —
  instead of two per service (architecture audit #8). Compose **stacks** are
  answered from the same snapshot via the `com.docker.stack.namespace`
  label, so the old `docker service ls` shell-out plus a per-service inspect
  for each stack is gone. When the daemon cannot be read at all the pass
  skips every swarm-backed row rather than mistaking "cannot see docker" for
  "nothing is deployed".
- Plain (non-stack) compose rows still shell out to `docker ps`; those are
  grouped **by server** and the servers run side by side, so one unreachable
  host no longer stretches the pass by its row count × the SSH timeout.
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
| `queue` | the deploy queue: `pending` (rows still `queued` in Postgres, from the snapshot each claim pass refreshes), `running` (jobs this process is building) and rows still `running` after 90 min (`stuck`) | never — warning only |
| `traefik` | `nixploy-traefik` Swarm service present (`docker service ls`, cached 10 s) | only when the panel bootstraps Traefik itself (`NIXPLOY_DISABLE_TRAEFIK_BOOT` unset); the production image sets it, so there a missing proxy is a warning |

Consumers: the image `HEALTHCHECK` (Swarm restarts a task that stays 503 and
`--update-failure-action rollback` reverts a bad update), the post-roll
probes in `install.sh` / `update.sh`, and `nixploy doctor`, which prints the
report next to the server/CLI versions and warns on a major-version mismatch.

## Missed cron ticks (opt-in catch-up)

node-schedule fires nothing for the time the process was down: a nightly
backup that coincided with an `update.sh` simply never runs (architecture
audit #17). Boot always **says so**, and can replay it on request:

- `modules/schedules/index.ts#findOverdueSchedules` and
  `modules/backups/scheduler.ts#findOverdueBackups` compare each enabled
  row's last run with its cron interval (`cronIntervalMs`, which reads two
  consecutive fire times out of node-schedule) and log a warning per row
  overdue by more than one interval, with the number of missed ones.
- "Last run" is `schedule.last_run_at` / `backup.last_run_at` /
  `volume_backup.last_run_at` (migration 0023). It is stamped **before** the
  command or dump starts, never after: a process killed mid-run has still
  moved the marker, so a crash loop cannot replay the same window forever.
  Rows written before 0023 carry no marker and fall back to the derived
  trace (the `deployment` row a schedule run writes, `backup_run` for a
  backup), then to the row's own creation time.
- `NIXPLOY_CRON_CATCH_UP=1` replays every overdue job **once** at boot —
  once per row, never once per missed interval — sequentially and detached,
  so a backlog cannot saturate the host or hold up the panel. Default off:
  a nightly dump that missed its window is often better skipped than run at
  11:00, and an arbitrary shell command replayed hours late can be worse
  than not running it. The warnings carry `catchUp: true|false` so the log
  says which mode produced them.

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
