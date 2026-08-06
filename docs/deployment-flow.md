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
   `<appName>` with the image, env, mounts, ports, resources, on the shared
   overlay network. Same-tag redeploys bump `TaskTemplate.ForceUpdate` —
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

`modules/compose/service.ts`: the raw compose file + `.env` are written under
the app's config dir, then `docker stack deploy` (compose type `stack`) or
`docker compose up` runs with project name `<appName>`. Service discovery for
domains uses `<appName>-<service>-1` container names. `resyncComposeDomains`
writes Traefik config per exposed service.

## Database lifecycle

`modules/databases/engine.ts`: create inserts the row with generated
credentials (encrypted); deploy creates the container with a named volume and
optional external port; start/stop/reload map to docker start/stop/restart;
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

- Git push webhooks (`/api/v1/...` hooks per provider, signature-verified,
  watch-path filtered) and the generic API-key deploy hook all end at the
  same `queueDeployment`.
- `pull_request` deliveries go to `handlePreviewWebhookForApplication`, which
  creates/redeploys/tears down the PR's preview and then posts the preview URL
  back on the pull request (`modules/preview/comment.ts`, GitHub/GitLab/Gitea).
  The comment carries a hidden marker so later pushes edit it in place instead
  of stacking new comments; a torn-down preview edits it to say so. Commenting
  is best effort — a missing token or API error never fails the deploy.
- Rollback (`modules/deployment` + `rollback` router) redeploys the image of
  a previous successful deployment — same pipeline, no source fetch.

## Boot & maintenance

- **Boot recovery** (`modules/deployment/recovery.ts`): deployments left
  `running` by a restart are marked `error` ("Interrupted…") so the status
  reconciler is not blocked by a deployment that can never finish.
- **Hourly maintenance cron** (`modules/deployment/maintenance.ts`): tears
  down previews past their `expiresAt`, and prunes deployment log files older
  than 30 days. Deleting an application or compose service also removes its
  log files, which live outside the app dir and have no FK to cascade through.
