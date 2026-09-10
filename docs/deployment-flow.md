# Deployment flow

How a service goes from "click Deploy" to a running container behind Traefik.

## The queue

`packages/server/src/modules/deployment/queue.ts` is an in-process FIFO queue
(one per server: local host is the `null` key, managed servers are keyed by
`serverId`). Routers call `queueDeployment(...)`, which inserts a `deployment`
row (`status: queued`) and enqueues a job. `worker.ts` dequeues and runs jobs;
a job can be cancelled while pending (dequeued) or running (its child
processes are killed). Queue depth per server is exposed for monitoring
(`queueDepth`).

Being in-process means: queue state does not survive an app restart. Rows
left in `queued`/`running` at shutdown should be treated as failed on boot —
the status reconciler (see `docs/architecture.md`) owns that cleanup.

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
6. **Finalize**: deployment row → `done` (with `logPath`), service status →
   `done`; on failure → `error`, with the error message on the deployment row.
   `events.ts` fans out to notification channels (deploy success/failure).

The full log stream goes both to the deployment log file and to subscribers
of `/ws/deployment` (`logger.ts`), which the UI renders live.

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
  `running` by a restart are marked `error` ("Interrupted…") so the status
  reconciler is not blocked by a deployment that can never finish. Interrupted
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
