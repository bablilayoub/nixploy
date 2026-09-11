# Deployment flow

How a service goes from "click Deploy" to a running container behind Traefik.

## The queue

The `deployment` **table is the queue**. `queueDeployment(...)`
(`modules/deployment/index.ts`) inserts a row with `status: queued`; the
worker loop in `modules/deployment/queue.ts` claims it straight from Postgres
with one atomic statement and hands it to `worker.ts`, which runs the
pipeline and finalizes the row as `done` / `error` / `cancelled`. Nothing
about *which* job runs next lives in process memory, so a restart, a crash or
a `SIGKILL` mid-build never loses the backlog — the rows are still `queued`
and the next boot picks them up.

### The claim

```sql
update "deployment" d
set "status" = 'running', "started_at" = now()
from (
  select q."deployment_id", coalesce(a."app_name", c."app_name") as app_name
  from "deployment" q
  left join "application" a on a."application_id" = q."application_id"
  left join "compose" c on c."compose_id" = q."compose_id"
  where q."status" = 'queued'
    and q."server_id" is not distinct from $1::text
    and coalesce(a."app_name", c."app_name") is not null
    and not (q."deployment_id" = any($2::text[]))
    and not exists (
      select 1
      from "deployment" r
      left join "application" ra on ra."application_id" = r."application_id"
      left join "compose" rc on rc."compose_id" = r."compose_id"
      where r."status" = 'running'
        and coalesce(ra."app_name", rc."app_name") = coalesce(a."app_name", c."app_name")
    )
  order by q."created_at", q."deployment_id"
  for update of q skip locked
  limit 1
) s
where d."deployment_id" = s."deployment_id"
returning d."deployment_id", d."application_id", d."compose_id", d."is_preview",
  d."title", d."server_id", s."app_name"
```

What each clause buys:

- `server_id is not distinct from $1` + `order by created_at` — **FIFO per
  target server** (the Nixploy host is the `null` key).
- `not exists (… status = 'running' … same app_name)` — the **per-app
  mutex**: two jobs for one service never build at once whatever
  `NIXPLOY_DEPLOY_CONCURRENCY` says (they would race on the code checkout and
  the `<appName>:latest` tag). A busy app's row stays in line and the next
  app's row takes the free slot.
- `for update of q skip locked` — two claimers can never be handed the same
  row. (`of q`: Postgres refuses `FOR UPDATE` on the nullable side of an
  outer join.)
- `$2::text[]` — ids the caller knows must wait even though SQL cannot tell;
  see "previews" below.

### What is still in process memory, and why

- **Slot accounting** per server (`NIXPLOY_DEPLOY_CONCURRENCY`, default 1),
  the set of running jobs, their child processes and their cancellation
  state. All of it only means anything inside the process that is building.
- **Job details the row does not carry**: `previewDeploymentId` and, for a
  preview, its own `appName`. The `deployment` table has neither column, so
  `queueDeployment` records them in a small `globalThis` registry and the
  claim reads them back. Queued previews never survive a restart (boot
  recovery fails them, as before), so a queued preview row always has its
  entry. **Open schema item**: adding `app_name text` and
  `preview_deployment_id text` to `deployment` would delete the registry,
  make preview coalescing pure SQL, and let queued previews survive a
  restart like everything else.
- **The queue-position / depth snapshot**, which *is* computed in SQL
  (`row_number() over (partition by server_id order by created_at,
  deployment_id)`) on every claim pass and after every enqueue, then cached
  so `getQueuePosition` / `queueDepth` stay synchronous for their tRPC and
  `/api/ready` callers.

### Rules the queue enforces

- **Coalescing** — `queueDeployment` inserts and supersedes in ONE
  transaction, under `pg_advisory_xact_lock(hashtext(appName))` so two
  pushes landing in the same millisecond cannot each insert a row and find
  nothing to supersede. The older `queued` row(s) for the app end as
  `cancelled` with `errorMessage = "Superseded by a newer deployment"` (not
  `error`, so a push burst never counts as failures in stats, streak alerts
  or Deploy Copilot). The `where status = 'queued'` guard is what makes this
  safe against a concurrent claim: exactly one of "cancelled" and "claimed"
  can win. A burst of N pushes therefore yields at most one running + one
  queued job per app.
- **Previews** coalesce and mutex on the *preview* appName, which SQL cannot
  derive (their row names the parent application): the sibling ids come from
  the in-process registry, and the claim's `$2` blocked-id list keeps a
  queued preview waiting while its own service is building.
- **Cancellation** — a `queued` row is finalized by a conditional
  `UPDATE … WHERE status = 'queued'` (atomic against a concurrent claim); a
  running job has every registered child process killed and the worker
  finalizes it. Cancellations carry a reason (`user`, `timeout`, `shutdown`)
  so the worker records the right outcome.
- **Wake-up** — the loop is woken by the `enqueued` event on
  `deploymentEvents` and by a freed slot; a fallback poll runs every 2 s
  while rows are waiting and every 15 s when the line is empty.
- **One loop per process** — the state lives on `globalThis`
  (`__nixployDeploymentQueue`), like `deploymentEvents`. Next transpiles
  `@nixploy/server` into its route bundles, so the request graph that
  enqueues jobs and the custom server (`server.ts`, loaded through tsx) that
  recovers and drains them are two instances of `queue.ts`; module-level
  state would give each its own invisible queue, two claim loops, and a
  SIGTERM drain that misses every real build.
- The in-memory parts are process-local by design: a multi-replica `nixploy`
  is still unsupported. The claim query itself is already multi-worker safe
  (`SKIP LOCKED`), which is what makes a separate `nixploy-worker` service
  possible later.

### Timeouts

| Knob | Default | Scope |
| --- | --- | --- |
| `NIXPLOY_COMMAND_TIMEOUT_MS` | 30 min | Every local spawn (`execAsync`, `execAsyncWithStdin`, `spawnTargeted`): on expiry the whole process group is SIGTERMed (SIGKILL 5 s later) and the call rejects with a "timed out" error. Also the fallback for SSH commands. |
| `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS` | 30 min | SSH commands (`execAsyncRemote`, `execAsyncRemoteWithStdin`, remote `spawnTargeted`); overrides the generic knob. |
| `NIXPLOY_DEPLOY_TIMEOUT_MS` | 60 min | Per-job deadline from the moment the worker picks a job up. On expiry the job is cancelled with reason `timeout` and finalized as `error` ("Deployment exceeded 60 minutes"). |

The worker races the pipeline against the queue's cancellation signal, so a
job stuck in a step that is not process-bound (hung SSH handshake, Docker API
call, DB query) still finalizes on cancel/deadline/shutdown; the abandoned
pipeline dies at its next `ctx.run` / checkpoint. Notifications and incident
recording run detached after the `finish` event, so the queue slot is released
without waiting on a slow notification channel.

### Graceful shutdown

`apps/web/server.ts` handles `SIGTERM`/`SIGINT` (Swarm updates, `update.sh`,
Ctrl-C): stop claiming rows and stop accepting HTTP connections → cancel the
node-schedule crons (`lib/shutdown.ts`, bounded wait for a running tick) →
close websocket clients with `1001` (the log viewer reconnects after the
restart) → wait up to `NIXPLOY_SHUTDOWN_GRACE_MS` (default 60 s) for running
deployments; whatever is still building is cancelled with reason `shutdown`
and finalized as `error` ("Interrupted by panel shutdown") → `exit 0`. The
backlog needs no handling at all: those rows are still `queued` in Postgres
and the next boot claims them. A
second signal forces an immediate exit; a backstop timer (grace + 30 s) exits
`1` if anything hangs. Keep the Swarm `--stop-grace-period` of the `nixploy`
service above the grace (the installer sets 90 s) or Docker kills the process
mid-finalization. `unhandledRejection` is logged and survived;
`uncaughtException` is logged and exits `1`.

## Application deploy pipeline (`worker.ts`)

1. **Context** (`context.ts`): load the application + tenancy, resolve env
   vars (org → project → environment → service, `modules/deployment/env.ts`),
   compute the build dir under
   `$NIXPLOY_CONFIG_DIR/applications/<appName>/code`.
2. **Source** (`sources.ts`): fetch the code — git clone (generic/GitHub/
   GitLab/Bitbucket/Gitea via stored credentials), pull a docker image, or
   unzip a drag-and-drop upload.
3. **Build** (`builders/`): produce a runnable image.
   - `nixpacks.ts` / `railpack.ts` — auto-detected builds. Their CLIs run on
     the host: an installed binary wins, otherwise a pinned release is
     downloaded once into `$NIXPLOY_CONFIG_DIR/tools` (the
     `ghcr.io/railwayapp/nixpacks` image is only a Nix base, and railpack
     ships no public image). Railpack additionally needs a BuildKit daemon —
     a shared `nixploy-buildkit` container is auto-provisioned and passed as
     `BUILDKIT_HOST`.      Managed servers must have the CLIs installed
     themselves (clear error otherwise). **Metrics history** only samples
     local services; managed-server services are live-WS only
     (see `docs/observability.md`).
   - `dockerfile-builder.ts` — build the repo's Dockerfile (path/context/stage,
     `--build-arg` from build args).
   - **Build env vs runtime env.** Builders receive only the application's
     *build args* (`resolveBuildEnv`, `modules/deployment/env.ts`): nixpacks,
     railpack and pack get them as `--env`, the Dockerfile builder as
     `--build-arg`. The merged runtime env (org → project → environment →
     service) goes to the Swarm service only — it used to be handed to the
     builders too, which baked runtime secrets into image layers and the
     BuildKit cache. **Migration note:** an app whose build read a runtime
     variable (a `NEXT_PUBLIC_*` value, a private registry token) must move
     that key into Build args; until then set
     `NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` on the `nixploy` service to restore
     the old merge (build args still override runtime values by key).
   - `buildpacks.ts` — Heroku or Paketo buildpacks via `pack` (local binary
     or the `buildpacksio/pack` image). **Platform caveat**: both builders
     ship amd64-only images — on arm64 hosts the build succeeds but the
     resulting image may not run natively. Prefer nixpacks/railpack/
     dockerfile on arm64; buildpacks are fine on x86 servers.
   - `static.ts` — publish dir served by an nginx image (SPA rewrite
     optional).
   - docker-image source skips the build entirely.
4. **Swarm upsert** (`swarm.ts`): create or update the swarm service
   `<appName>` — always through the primary manager — with the image, env,
   mounts, ports, resources, on the shared overlay network; services pinned
   to a managed server get a `node.id==<swarmNodeId>` placement constraint
   (merged with the user's own constraints). Same-tag redeploys bump `TaskTemplate.ForceUpdate` —
   otherwise the spec is identical, the swarm no-ops, and tasks keep
   running the OLD image.
5. **Traefik sync** (`modules/application/service.ts#syncApplicationTraefik`):
   rewrite `<appName>.yml` from the service's domain rows (see
   `docs/domains-traefik.md`).
6. **Finalize**: the row arrives already `running` (the claim set that and
   `startedAt` atomically — the worker only mirrors it onto the service row);
   on success it becomes `done` (with `logPath`), service status →
   `done`; on failure → `error`, with the error message on the deployment row.
   `events.ts` fans out to notification channels (deploy success/failure).

The full log stream is appended to the deployment log file by `logger.ts`,
which also emits a `log` event on `deploymentEvents` per chunk. `/ws/deployment`
(`ws/deployment-logs.ts`) replays the file, then follows it by byte offset
(`stat` size + positional read) woken by those events — no per-client file
re-read or DB poll; a 5 s status check remains as a safety net. `deployment.getLogs`
reads from the byte `offset` it returned last time for the same reason.

### Pre-flight

`application.deploy` / `redeploy` and `compose.deploy` / `redeploy` refuse
with `PRECONDITION_FAILED` before a row is queued when there is nothing to
fetch (`applicationReadiness` / `composeReadiness`,
`modules/deployment/provenance.ts`): a docker source without an image, a
generic git source without a URL, a provider source without owner +
repository, a drop source without an uploaded archive, a raw compose without
a file. `application.one` and `compose.one` return the same predicate as
`readiness: { canDeploy, reason? }`, which the headers use to disable Deploy
with the reason as the tooltip instead of toasting a false "queued".

### Provenance

Every `deployment` row records what started it (`trigger`, migration 0020)
and who (`triggeredBy`): `manual` (browser session, user id), `api` (API
key — REST, CLI, MCP, the generic deploy hook — user id of the key owner),
`webhook` (`webhook:<provider>`), `schedule` (`schedule:<id>`), `preview`,
`rollback`, `redeploy` (Copilot apply & redeploy, template re-run), `gitops`,
`system`. Provider push webhooks also fill `commitSha` / `commitMessage` /
`commitAuthor` from the payload (`extractPushCommit`); pull-request
deliveries carry the head sha. After a git checkout the worker runs
`git log -1 --format=%H%n%an%n%s` in the code dir and fills whichever of the
three fields is still null (`readCheckoutCommit`); docker-image sources store
the registry digest in `commitSha` and the image reference in
`commitMessage`. `deployment.byApplication` / `byCompose` / `byProject` /
`recent` join the actor's display name as `triggeredByName`. The history
table renders a trigger chip, the short sha (linked to the provider's commit
page when the source is a repository — `buildCommitUrl`), the first line of
the message and the author. GitLab and Gitea links need the integration's
base URL because both are commonly self-hosted: applications carry it through
the `gitlab`/`gitea` relation on `application.one`, while `compose.one` does
not load those relations, so a compose service's sha stays plain text rather
than guessing gitlab.com.

### Deploy feedback loop (UI)

One hook, `apps/web/src/hooks/use-running-deployments.ts`, watches
`deployment.recent` and polls only while something is queued or running.
The top-nav hairline, the application/compose headers ("Queued (#n)" /
"Deploying" in place of the stale service status, last failure line + "View
logs") and the project services table read it; when a deployment settles the
hook invalidates `application.one` / `compose.one`, the `all` lists,
`environment.byProject` and the deployment lists once, so badges catch up
without per-page timers. Queuing a deploy switches to
`?tab=deployments&deployment=<id>`; `DeploymentHistory` opens that row's log
drawer as soon as it is listed.

## Compose deploy pipeline

`modules/compose/service.ts`: the compose file is **rendered** first —
every `${VAR}` / `$VAR` reference is resolved from the merged env
(`interpolateComposeString`), the safety checks run on the raw *and* the
rendered spec, and the result is written to `docker-compose.nixploy.yml`
next to the source (`.env` values are quote-stripped, nothing else is
interpreted). `buildComposeDeployCommand` then runs `docker stack deploy`
(compose type `stack`) or `docker compose up` with project name `<appName>`
under `env -i` so tenant variables never reach the docker CLI's process
environment. Every service is attached to a private `<appName>-net`; only
services that have a domain also join `nixploy-network` with the alias
`<appName>-<service>` (added at runtime when a domain is created later). Service discovery for
domains uses `<appName>-<service>-1` container names. `resyncComposeDomains`
writes Traefik config per exposed service.

## Database lifecycle

`modules/databases/engine.ts`: create inserts the row with generated
credentials (encrypted); deploy creates the swarm service with a named
`<appName>-data` volume (Postgres ≥ 18 gets `PGDATA` inside it) and an
optional external port; deploy/remove refuse services that do not carry the
`nixploy.managed` labels, removal waits for the task before dropping the
volume, and `appName` is frozen once deployed. Mongo replica sets are not
supported; start/stop/reload map to docker start/stop/restart;
status (`running`/`stopped`/`error`) comes from container inspection, and
`buildConnectionUrl` renders the DSN shown in the Connection tab. Backups run
through `modules/backups` to S3 destinations on schedules.

## Start / stop / status semantics

- **Stop**: scale the swarm service to 0 (apps) / `docker compose stop` /
  `docker stop` (databases). Nothing is deleted; state persists.
- **Start**: scale back up / start containers; a previous deploy must exist.
- **Status** on the row is written by lifecycle actions and deploys; the
  reconciler cron corrects drift against real container state (e.g. after
  host reboots or external `docker` commands).
- **Delete**: remove swarm service/containers → remove Traefik config → wipe
  on-disk state → delete the row (mounts, ports, domains, deployments
  cascade).

## Webhooks & rollbacks

- Git push webhooks (`/api/webhooks/<provider>/...`, signature-verified,
  watch-path filtered) and the generic API-key deploy hook all end at the
  same `queueDeployment`.
- `pull_request` deliveries go to `handlePreviewWebhookForApplication`, which
  creates/redeploys/tears down the PR's preview and then posts the preview URL
  back on the pull request (`modules/preview/comment.ts`, GitHub/GitLab/Gitea).
  The comment carries a hidden marker so later pushes edit it in place instead
  of stacking new comments; a torn-down preview edits it to say so. Commenting
  is best effort — a missing token or API error never fails the deploy.
  Fork PRs are gated by `previewForksRequireApproval` (default on): they land
  as `awaiting_approval` without a build until an org member approves in the
  UI — repo collaborators bypass the gate (`modules/preview/fork-gate.ts`,
  see [domains-traefik.md](./domains-traefik.md#fork-pull-requests-require-approval)).
  A fork's branch does not exist in the base repository, so fork previews
  build from the provider's PR head ref (`refs/pull/<n>/head` on GitHub and
  Gitea, `refs/merge-requests/<iid>/head` on GitLab) or, on Bitbucket Cloud,
  from the fork repository itself; the encoded source lives in
  `previewDeployments.branch` (`modules/preview/source-ref.ts`). Metadata-only
  PR edits never rebuild: GitLab `update` events without `oldrev` and Bitbucket
  `updated` events whose head commit is already checked out are ignored.
- Preview services (`<app>-pr-<n>`) run the parent's image and merged env but
  none of its published ports, volumes or file/bind mounts, as a single
  replica; their Traefik file forwards to the parent domain's container port
  and carries the parent's basic-auth and redirects.
- Every terminal deploy status fans out to the organization's notification
  channels (`emitDeployNotification`: `appDeploy` on success, `appBuildError`
  on failure; cancellations stay silent). Compose deploys notify too.
- Rollback (`modules/deployment/rollback.ts`, `rollback` router,
  `application.rollback`): every successful application deploy pins the image
  it runs as a `rollback` row. Built images are retagged
  `appName:<version>` (`version` = first 12 chars of the deployment id;
  `appName:latest` is overwritten by the next build), docker sources record
  the registry digest. The newest 5 pins per app are kept; older rows and
  their local tags are pruned. Rolling back repoints the swarm service at the
  pinned image — no source fetch, no build — and records a `Rollback`
  deployment with a short log.

## Boot & maintenance

- **Boot recovery** (`modules/deployment/recovery.ts`): deployments left
  `running` by a restart are marked `error` ("Interrupted…") — not just
  cosmetic: the status reconciler skips a service with a running deployment,
  and the queue's per-app mutex would refuse to ever build that app again.
  Rows left `queued` need nothing; the claim loop picks them up in creation
  order, which is what makes the backlog survive a restart. Two exceptions
  are failed instead: queued **previews** (the row carries neither the
  preview id nor the preview appName) and queued rows whose service no
  longer exists (invisible to the claim query otherwise). Interrupted
  previews land on `previewDeployments.previewStatus = error`; the parent
  application's status is left alone.
- **Docker cleanup** (`modules/deployment/cleanup.ts`, cron + manual trigger)
  prunes dangling images and the BuildKit cache only. Tagged images — a
  stopped application's `appName:latest`, rollback pins, images pulled for
  compose stacks — are never pruned: they are the only local copy of built
  images, and an `image prune -a` broke Start until a full rebuild.
- **Hourly maintenance cron** (`modules/deployment/maintenance.ts`): tears
  down previews past their `expiresAt`, and prunes deployment log files older
  than 30 days. Deleting an application or compose service also removes its
  log files, which live outside the app dir and have no FK to cascade through.
