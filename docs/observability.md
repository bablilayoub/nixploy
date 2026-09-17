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
  `$NIXPLOY_CONFIG_DIR/metrics/<appName>.jsonl`, kept to the retention
  window below (48h by default).
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

### Metrics retention

`NIXPLOY_METRICS_RETENTION_HOURS` sets how much history the JSONL store
keeps. Default **48**, minimum 1, maximum 720 (30 days); anything
unparseable, zero or negative falls back to the default rather than
disabling retention, and a larger value is clamped rather than honoured.
Read in exactly one place — `metricsRetentionHours()` in
`modules/monitoring/store.ts` — which the hourly compaction pass uses as its
cutoff.

Size it with the sample rate in mind: one service writes ~120 lines/hour
(~10 KB), so 48h is ~0.5 MB per service and 30 days is ~7 MB per service.
The files live under `$NIXPLOY_CONFIG_DIR/metrics/`, and a shorter window
trims existing files on the next compaction (at most hourly per file).
Longer-term storage belongs in Prometheus, below — the JSONL store is there
so the Monitoring tab has something to draw without any external system.

## Prometheus / OpenMetrics export

`GET /api/metrics` serves the calling API key's organization as Prometheus
text exposition (version 0.0.4, which OpenMetrics scrapers also accept):

```
curl -H "x-api-key: $NIXPLOY_API_KEY" https://panel.example.com/api/metrics
```

Authentication is the same path REST and MCP use (`buildApiKeyContext`), so
`x-api-key` **or** `Authorization: Bearer` works and the per-IP/per-key rate
limits, key scopes, organization binding and the org 2FA gate all apply. A
scrape is a read, so a **read-only** key is enough; no extra capability is
required beyond membership.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `nixploy_service_cpu_percent` | gauge | `service`, `kind`, `project`, `environment` | Latest sampled CPU, percent of one core |
| `nixploy_service_memory_bytes` | gauge | same | Latest sampled resident memory |
| `nixploy_service_memory_limit_bytes` | gauge | same | Memory limit the sample saw (0 = unlimited) |
| `nixploy_service_status` | gauge | same | 1 when Nixploy considers the service running |
| `nixploy_deployments_total` | counter | `status` | Deployment rows by status (`queued`/`running`/`done`/`error`/`cancelled`) |
| `nixploy_uptime_probe_up` | gauge | `probe` (host+path) | 1 when the last probe check succeeded |
| `nixploy_queue_depth` | gauge | `state` (`pending`/`running`) | This panel process's deploy queue |

Notes worth knowing before you alert on these:

- **The numbers come from the existing metrics store**, not from a fresh
  Docker call — a scrape costs two aggregate SQL queries and an in-memory
  ring read. The sampler writes every 30 s, so scraping faster than that
  simply sees the same point twice.
- **Services with no sample yet emit no cpu/memory series** (they would
  otherwise report a fake 0%); `nixploy_service_status` is always emitted, so
  `nixploy_service_status == 0` is the honest "it is down" signal.
- **Probes that have never been checked are omitted** rather than reported as
  down.
- **`nixploy_queue_depth` is process-local**, like the queue itself —
  multi-replica `nixploy` is unsupported by design.
- **One organization per key.** A Prometheus watching several organizations
  configures one job per key; there is deliberately no instance-wide dump,
  because it would put every tenant's project and service names into a file
  anyone with the scrape config can read.
- Empty families still print their `# HELP`/`# TYPE` headers, so an
  `absent()` alert does not fire the moment an organization has no services.

The renderer is a pure function (`modules/monitoring/prometheus.ts`,
`renderPrometheus`) over a snapshot, with the collection in the same module;
label values are escaped for backslash, quote and newline.

## Threshold alerts

- Org-level CPU/memory thresholds live in Settings → Platform → Host health
  (`webServerSettings.metricsConfig.webServer.{cpuAlertPercent,
  memoryAlertPercent}` — empty = disabled).
- The metrics-history pass keeps a rolling 5-sample window (~2.5 min) per
  service; a sustained average above a threshold fires a
  `serverThreshold` notification, once per 30 min per service + metric
  (`evaluateAlerts` in `modules/monitoring/history.ts`). Local and
  remote-hosted services alike (remote samples arrive over the SSH batch).

## Incidents

Incidents are the timeline under **Monitoring → Incidents**: failed deploys,
alert-rule trips, the failure watchdog and uptime flips all write one
(`recordIncident`, `modules/observability/index.ts`).

Two actions close the loop (`observability.acknowledgeIncident` /
`resolveIncident`, both gated on `project.write` and audited):

- **Acknowledge** records who is looking at it (`acknowledged_at` /
  `acknowledged_by`) and leaves the incident **open** — "seen it" is not
  "fixed it", and collapsing the two would lose the distinction the timeline
  exists for. Acknowledging twice keeps the first acknowledger.
- **Resolve** sets `resolved_at` (and back-fills the acknowledgement when it
  was skipped). An optional note is stored in `metadata.resolutionNote`,
  never in `title` — the title is what the public status page renders.

Resolved incidents are dropped by the retention pass 90 days later.

## Service event timeline

**Runtime → Events** on every service page answers the one question a Swarm
panel could not: *why did it restart?* One `service_event` row per fact about
a service, newest first, filterable by All / Failures / Deploys / Changes.

| Kind | Written by | Means |
| --- | --- | --- |
| `task_started` | reconciler | a Swarm task reached `running` |
| `task_failed` | reconciler | a task ended `failed` / `rejected` / `orphaned` |
| `oom_killed` | reconciler | the container was killed (exit 137 or a reported OOM) |
| `status_changed` | reconciler | drift it had to correct — something changed the service outside Nixploy |
| `deploy_started` · `deploy_finished` · `deploy_failed` · `deploy_cancelled` | deploy worker | a deployment transition, with its id |
| `rollback` | audit bridge | a rollback was applied |
| `config_changed` | audit bridge | settings, env, source, build type, start/stop — anything a mutation audited |

Three producers, no cron of its own:

- **The status reconciler** (`*/1 * * * *`) already reads every Swarm service
  and task to correct statuses; the same two API calls carry exit codes and
  error strings, so the timeline costs no extra daemon round-trip
  (`modules/deployment/reconciler-timeline.ts` + the pure derivation in
  `modules/observability/task-events.ts`).
- **The deploy worker**, on every transition it writes
  (`modules/observability/deploy-events.ts`). Preview deploys are recorded on
  the **parent** service, tagged `preview: true`.
- **The audit trail**: `recordAudit` mirrors any entry naming a service onto
  the timeline (`modules/observability/audit-events.ts`), so a router that
  starts auditing a new mutation gets a timeline row for free. Deploy verbs are
  skipped — the worker already writes those, with the deployment id attached.

Things worth knowing:

- **Writes are idempotent, not cursor-based.** The reconciler re-reads the
  same finished task every pass, so each row carries a `dedupe_key` unique per
  service and the insert is `on conflict do nothing`. There is no cursor to
  keep, invalidate or recover.
- **A pass looks back 30 minutes.** A task whose state is older than that was
  seen by an earlier pass. The cost: the first pass after an upgrade does not
  backfill history — the timeline starts when the feature does.
- **Exit 137 is reported as a kill, not asserted as an OOM.** Swarm's task API
  carries no `OOMKilled` flag (it is on the container, which is already gone),
  and `docker kill` produces the same code. The row says so, and keeps the exit
  code in `metadata`.
- **A pass records at most 20 events per service**, newest first, and logs what
  it dropped — a service churning faster than that is exactly the one being
  investigated, so the cap is never silent.
- **Plain (non-stack) compose has no tasks to read.** Its timeline carries
  deploys, rollbacks and config changes but no per-container rows.
- Rows never contain secret values: task metadata is exit codes and ids, and
  config rows carry changed field *names* and counts.

The chart annotations on **Runtime → Monitoring** are the same rows: deploys,
rollbacks and kills drawn as dashed vertical lines, so a spike and its cause
sit next to each other. Only the loud kinds are drawn — annotating every kind
turns the chart into a picket fence.

Deploy Copilot reads the last 20 events before a failure as context, so
"explain this failed deploy" can see the OOM four minutes earlier instead of
guessing from the build log alone.

Read it from a terminal:

```bash
nixploy events list <serviceId> --type application --kind oom_killed,task_failed --since 24h
```

REST: `GET /api/observability.serviceEvents?serviceType=application&serviceId=…`
(`kinds` accepts a comma-separated list; `cursor` continues from the previous
page's `nextCursor`).

## Public status page

`observability.enableStatusPage({ probeIds, title })` publishes selected
uptime probes at **`/status/<token>`**, an unauthenticated page
(`apps/web/src/app/status/[token]/page.tsx`). One `status_page` row per
organization holds the token, the title and the published probe ids; the
token is a 32-character url-safe secret and `rotateStatusPageToken` mints a
new one, invalidating every link shared so far. `disableStatusPage` takes the
page offline while keeping the token, so re-publishing restores the same URL.
The card lives under Monitoring → Incidents ("Status page"); publishing needs
`settings.manage`, because making organization data readable without a
session is an organization-level decision, not a per-project one.

What crosses the boundary is deliberately small: the probe's **host**, its
current state, a 90-day uptime percentage and the **titles** of recent uptime
incidents. No service ids, project names, probe paths, error strings, or
acknowledger identities. `loadPublicStatus` (`modules/observability/status-page.ts`)
is the only function that turns a public token into data.

The uptime percentage is derived from the probe's flip incidents, because
that is the only history Nixploy keeps — `uptime_probe` stores the *current*
state, there is no per-check sample table. `uptimePercentFromEvents` walks the
flips inside the window, infers the state before the first one by inversion
(a window whose first flip is a recovery opened in an outage), and counts an
unrecovered outage up to now. A probe younger than the window is measured
from its creation instead.

The route is `force-dynamic` (it needs the client IP) with a 30 s in-process
memo per token and a per-IP limit of 60 requests/minute, so a hammered link
costs one pair of queries per window and token enumeration is throttled.
It is also `robots: noindex` — an indexed status page defeats the token.

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
| `nixployRestart` | the panel process finishing boot, once per start (`emitInstanceRestartNotification`, called from `apps/web/server.ts`) — **and the platform self-alerts below** |

## Platform self-alerts

Org thresholds watch tenant services. Platform self-alerts watch the box the
panel runs on, so an operator learns about a full disk from Slack instead of
from a failed deploy. A cron every **5 minutes**
(`modules/monitoring/platform-alerts.ts`, registered by `startPlatformAlerts()`)
evaluates five checks:

| Alert | Warning | Critical | Source |
| --- | --- | --- | --- |
| `hostDisk` | filesystem holding the config dir > **85 %** | > **95 %** | `df -Pk <config dir>` |
| `queueStalled` | oldest deployment still `queued` for > **30 min** | — | `min(created_at)` over `deployment` rows in `queued` |
| `certExpiry` | an ACME certificate expires in < **14 days** | it already expired | `<config>/traefik/acme.json`, parsed with `node:crypto`'s `X509Certificate` — skipped when the file is absent or empty |
| `platformService` | — | `nixploy-traefik` / `nixploy-postgres` below their desired replicas | dockerode `listServices` + `listTasks`; skipped entirely when `NIXPLOY_DISABLE_TRAEFIK_BOOT` is unset only for the panel-managed case — a service that does not exist on this host is never an alert |
| `instanceBackup` | no successful instance backup in `NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS` days (default **8**, `0` disables), or never | — | newest `backup_run` with `kind = 'instance'`, `status = 'success'` |

Where they go:

- **Channels.** Platform alerts are instance-level, so they are *not* fanned
  out per organization. They go to every notification channel that has the
  `nixployRestart` ("Nixploy restarted") toggle on **and** belongs to an
  organization with at least one instance-admin member. A tenant org that
  turns the toggle on still never sees platform internals.
- **Cooldown.** One notification per `kind:severity` per **24 h**, persisted
  in `<config>/platform-alerts.json` (mode 600) so a panel restart does not
  re-fire everything. An escalation from `warning` to `critical` notifies
  immediately; an alert that resolves forgets its cooldown, so it can fire
  again as soon as it returns.
- **`GET /api/ready`.** The same file is reported as the `platform` check —
  `{ evaluatedAt, alerts: [{ kind, severity, summary }] }` plus a `warning`
  line. It is **advisory only**: a full disk must never make Swarm restart a
  panel that still serves, so the check is always `ok`.
- **Monitoring → Fleet** shows a "Platform alerts" card (instance admins
  only) fed by the same endpoint.

### Weekly Docker cleanup (opt-in)

`NIXPLOY_DOCKER_CLEANUP_CRON` is **unset by default**. Set it to a cron
expression (e.g. `0 4 * * 0` — Sunday 04:00 in the process timezone, UTC in
the shipped image) and the panel prunes dangling images plus the BuildKit
cache on the Nixploy host once a week and emits the existing `dockerCleanup`
notification. Tagged images are never touched (a stopped application's
`appName:latest` must survive — see `modules/deployment/cleanup.ts`).

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
| `platform` | the last platform self-alert pass (see above), read from `<config>/platform-alerts.json` — never re-evaluated here | never — warning only |

Consumers: the image `HEALTHCHECK` (Swarm restarts a task that stays 503 and
`--update-failure-action rollback` reverts a bad update), the post-roll
probes in `install.sh` / `update.sh`, and `nixploy doctor`, which prints the
report next to the server/CLI versions and warns on a major-version mismatch.

## Platform logs

Everything above is about *tenant* services. This section is about the panel
itself — where its own output goes and how to read it.

```bash
docker service logs -f nixploy               # the panel process
docker service logs -f nixploy-postgres      # the platform database
docker service logs -f nixploy-traefik       # the proxy (level ERROR, no access log)
docker service ps nixploy --no-trunc         # why a task was replaced
```

All three services run on the `json-file` driver with rotation
(`max-size=10m`, `max-file=3`, set by `install.sh` / `update.sh`), so an
unbounded log cannot fill a small host. `docker service logs` needs
`json-file` or `journald` — do not switch the driver.

**Subsystem prefixes.** The panel logs through `lib/logger.ts`: one line per
event, prefixed with the subsystem in brackets. The ones you will actually
look for:

| Prefix | Subsystem |
| --- | --- |
| `[server]` | boot, listen, SIGTERM drain |
| `[deploy]` / `[deploy-queue]` | the deploy worker and its queue |
| `[status-reconciler]` | the 60 s drift pass |
| `[metrics-history]` | the 30 s sampler |
| `[platform-alerts]` | the 5 min self-alert pass |
| `[backups]` / `[schedules]` / `[updates]` | the other crons |

**Levels and format.** `LOG_LEVEL` is `debug` | `info` | `warn` | `error`
(default `info`). `LOG_FORMAT=json` switches to one JSON object per line —
`{ts, level, subsystem, message, ...meta}` — which is what you want when
shipping to Loki/Elastic/Datadog. Both are forwarded by `install.sh` /
`update.sh` when set. Reading JSON logs by hand:

```bash
# only errors, newest last
docker service logs nixploy 2>&1 | grep '"level":"error"' | tail -20

# one subsystem, pretty-printed (jq optional but much nicer)
docker service logs nixploy 2>&1 | jq -c 'select(.subsystem=="deploy")'

# without jq
docker service logs nixploy 2>&1 | python3 -c 'import json,sys
for line in sys.stdin:
    try: e = json.loads(line)
    except ValueError: continue
    print(e["ts"], e["level"], e["subsystem"], e["message"])'
```

**Build logs** are not process logs: every deployment writes
`<config>/logs/<appName>/<deploymentId>.log` (streamed live to the UI,
pruned by the retention cron below). Schedule output lands under
`<config>/schedules`. Neither is in `docker service logs`.

**Secrets never reach the log.** Tokens, passwords and env values are
redacted or passed over stdin (`execAsyncWithStdin`); a log line that
contains a credential is a bug worth reporting.

## Jobs: schedules that run their own container

A schedule has two axes. `scheduleType` says **which service** it belongs to
(`application`, `compose`, `server`, `nixploy-server`) and drives every
access check; `runMode` says **how the command runs**:

| `runMode` | What happens |
| --- | --- |
| `exec` (default) | `docker exec` into a container that is already running — the historical behaviour. The service has to be up. |
| `image` | `docker run --rm` a throwaway container from the schedule's `image`. The service can be stopped. |

An image job is the standalone job/cron service (product audit, Platform row
"No standalone job/cron service"): a nightly report, a migration, a cleanup
that has no business keeping a container alive all day.

What an image job gets (`modules/schedules/image-job.ts`):

- the application's / stack's **environment overlay**, so it reaches that
  environment's database by name;
- the **merged env** — organization → project → environment → service, the
  same inheritance a deployment resolves — handed over an `--env-file`
  written `0600` on the target host. Secrets never reach argv, where `ps`
  shows them;
- the container hardening baseline from `deployment/swarm.ts`
  (`--cap-drop ALL` plus the seven standard adds, `no-new-privileges`, a pids
  ceiling);
- `--entrypoint sh`. This is load-bearing: without it the image's own
  ENTRYPOINT receives `sh -c '<command>'` as *arguments* and ignores them, so
  the job silently never runs. **Exit 127 means the image has no `/bin/sh`** —
  scratch and distroless images cannot host a job.
- a deadline: `NIXPLOY_SCHEDULE_TIMEOUT_MS`, falling back to
  `NIXPLOY_HOOK_TIMEOUT_MS` (default 10 minutes). The env file and a container
  that outlived the deadline are always cleaned up.

`bash` schedules re-enter bash from `sh` when the image has one and fall back
to `sh` when it does not, so a job does not fail with "bash: not found" just
because the row's default shell is bash.

**Run once** (`schedule.runOnce`) runs the same container with no schedule row
behind it — a one-off migration or smoke command. It writes the same run log
and `deployment` row a scheduled run writes, so the output shows up in the
service's history. Image jobs are only available on `application` and
`compose` targets, which is where the env and the network come from.

Run output is written to `<config>/schedules/<scheduleId>-<timestamp>.log`
with mode `0600`: it is whatever the command printed, which regularly includes
connection strings and dump paths.

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

Every cron expression in the panel — database and volume backups, schedules,
the update checker, the platform self-alerts — runs in the **process time
zone**, which is UTC in the production image unless you set one. `0 3 * * *`
is 03:00 UTC, not local time; the inputs are labelled accordingly.

To run them in your own zone, set `TZ` (the image ships `tzdata`, so the
zone actually resolves) and let the installer forward it:

```bash
TZ=Europe/Paris curl -fsSL …/update.sh | sudo bash
# or once, by hand:
docker service update --env-add TZ=Europe/Paris nixploy
```

Changing `TZ` restarts the panel and **shifts every existing cron** — a
`0 3 * * *` backup that ran at 03:00 UTC now runs at 03:00 local. Decide
once, at install time, rather than after schedules exist.

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
- drops `service_event` rows older than 90 days, and anything beyond the newest
  1 000 per service (a service in a crash loop writes a row every few seconds,
  and the per-service cap is what stops one sick service owning the table);
- drops `audit_log` rows older than `NIXPLOY_AUDIT_RETENTION_DAYS` (default
  `365`; `0` keeps them forever);
- warns about uploaded TLS certificates expiring within 21 days — an incident
  plus the `certificateExpiry` notification event, once a day per certificate
  (see [domains & Traefik](./domains-traefik.md#expiry-warnings)).

## Healthchecks

Applications → Advanced → Healthcheck writes a Docker `Healthcheck`
(`healthCheckSwarm` jsonb column) onto the swarm service: an HTTP probe
against `127.0.0.1:<port><path>` inside the container with configurable
interval/timeout/retries/start-period. The image must contain `curl` or
`wget` — otherwise the probe itself fails and Docker keeps restarting the
container as unhealthy (the reconciler will surface it as `error`).
