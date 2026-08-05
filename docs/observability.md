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
  Managed-server services are live-only (SSH sampling is too expensive).
- `monitoring.history { appName, hours }` returns the window downsampled to
  ≤240 points; the Monitoring tab's range picker (Live / 1h / 6h / 24h /
  48h) switches between the live `/ws/stats` feed and history (network and
  disk rates are computed from consecutive cumulative deltas).
- The Monitoring header shows a 24h uptime chip (share of 30s slots with
  samples) for local services, and a "Service is not running" empty state
  with Retry when the live stats socket reports no container — no more
  infinite "Connecting…" for stopped services.
- KPI cards: CPU, memory, network in/out, disk I/O and process count, each
  with a sparkline or meter. Charts share a synced cursor (`syncId`) and
  draw dashed peak markers; services with multiple replicas get a
  per-replica breakdown (`monitoring.replicaStats`).

## Threshold alerts

- Org-level CPU/memory thresholds live in Settings → Web Server
  (`webServerSettings.metricsConfig.webServer.{cpuAlertPercent,
  memoryAlertPercent}` — empty = disabled).
- The metrics-history pass keeps a rolling 5-sample window (~2.5 min) per
  local service; a sustained average above a threshold fires a
  `serverThreshold` notification, once per 30 min per service + metric
  (`evaluateAlerts` in `modules/monitoring/history.ts`). Local services
  only (sampling is local).

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

## Healthchecks

Applications → Advanced → Healthcheck writes a Docker `Healthcheck`
(`healthCheckSwarm` jsonb column) onto the swarm service: an HTTP probe
against `127.0.0.1:<port><path>` inside the container with configurable
interval/timeout/retries/start-period. The image must contain `curl` or
`wget` — otherwise the probe itself fails and Docker keeps restarting the
container as unhealthy (the reconciler will surface it as `error`).
