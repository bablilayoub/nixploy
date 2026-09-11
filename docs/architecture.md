# Architecture

Nixploy is a self-hosted PaaS built as a pnpm
monorepo. One Node process serves the UI, the API, the realtime streams and
the deploy engine.

## Packages

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@nixploy/web` | Next.js 16 (App Router) + Tailwind v4 + shadcn/ui. Custom `server.ts` (tsx) wraps Next with WebSocket endpoints, the in-memory deploy queue and node-schedule crons. |
| `apps/cli` | `@nixploy/cli` | CLI talking to the REST API with an `x-api-key` header. |
| `packages/server` | `@nixploy/server` | Everything server-side: Drizzle schema, better-auth config, tRPC routers, deploy engine, builders, Traefik/Docker utils, backups, notifications, templates catalog. |

Supporting files: `docker/` (production Dockerfile, dev compose, Traefik
static config), `install.sh` (production installer), `PLAN.md` (product
blueprint), `docs/` (these guides).

## Request surfaces (one process by default)

```
Browser ──► apps/web (Next.js App Router)              UI
   │
   ├────► /api/trpc/*        tRPC fetch handler ──► packages/server routers
   ├────► /api/auth/*        better-auth handler
   ├────► /api/<router>.<proc>  REST/OpenAPI wrapper over the same root router (x-api-key)
   ├────► /swagger           generated OpenAPI docs
   └────► /ws/{logs,deployment,events,stats,terminal}   WebSocket streams (server.ts)
```

One process is the default (`NIXPLOY_ROLE=all`). A split install
(`install.sh --split-worker`) runs the same image twice: `nixploy`
(`NIXPLOY_ROLE=panel`) serves everything above, and `nixploy-worker`
(`NIXPLOY_ROLE=worker`, `apps/web/worker.ts`) owns the deploy claim loop, boot
recovery, every cron and the Traefik bootstrap — no Next at all, just
`/api/health`, `/api/ready` and `/api/version` for Swarm. The two halves talk
over Postgres `LISTEN/NOTIFY`; roles, channels and cancellation semantics are
in [`deployment-flow.md`](./deployment-flow.md) → "Process roles and the worker
service".

Every tRPC procedure is automatically also a REST endpoint and reachable from
the CLI — they all hang off the same root router
(`packages/server/src/trpc/root.ts`). A procedure that is not registered
there does not exist anywhere.

## Tenancy model

```
organization ──► project ──► environment ──► service
```

Service kinds: `application`, `compose`, `postgres`, `mysql`, `mariadb`,
`mongo`, `redis`. Every service row carries an `appName` (unique swarm-safe
slug like `echo-4a4487`), an `environmentId`, and an optional `serverId`
(null = the Nixploy host itself).

Every tenant-scoped procedure resolves the caller org through
`resolveCallerOrganizationId(userId, activeOrganizationId)`
(`packages/server/src/modules/projects/index.ts`): it validates the session's
active organization when set, and falls back to the caller's first membership
otherwise. Access checks then compare `service → environment → project →
organizationId` (see `assertApplicationAccess` and friends in
`modules/application/org.ts`).

## Server package layout (`packages/server/src`)

- `db/schema/*` — Drizzle tables; `custom-columns.ts` holds `encryptedText`
  (AES at rest, keyed by `ENCRYPTION_KEY`) for secrets.
- `trpc/routers/*` — one file per domain (application, compose, domain,
  deployment, project, notification, …), merged in `trpc/root.ts`.
- `modules/<domain>/` — the actual engine, grouped by domain:
  - `application/` — app lifecycle (create/start/stop/delete), swarm service
    upsert, env resolution, org access helpers.
  - `compose/` — docker-compose/stack deploys, per-service domains.
  - `databases/` — shared engine + per-type router factory for the five
    database kinds (credentials, external ports, connection URLs, reload).
  - `deployment/` + `deployments/` — deploy queue, build orchestration,
    status transitions, history/stats; builders (Nixpacks, Railpack,
    Dockerfile, Heroku/Paketo buildpacks, static).
  - `traefik/` — static + dynamic config writers, file-provider sync.
  - `projects/` — project/environment CRUD, org resolution, env-var
    inheritance (org → project → environment → service).
  - `services/` — the service-kind registry (see below).
  - `backups/`, `schedules/`, `notifications/`, `git/`, `cluster/`,
    `templates/` — see their READMEs/tests.

A service is one of seven kinds (`application`, `compose` and the five
database engines), and each kind has its own Drizzle table with its own
`<kind>Id` primary key. `modules/services/` keeps that fan-out in one place:
`kinds.ts` holds the kind tuple, labels and id fields with no imports at all
(the panel reads it too, so it must stay out of the browser bundle's way),
and `registry.ts` maps each kind to its table, primary-key column, tag join
table, backup FK and a small set of row operations. Tenancy lookups, tag
writes, project counts, cascade deletes, the fleet view, the backup router
and GitOps apply all dispatch through `SERVICE_REGISTRY[kind]` instead of
repeating a seven-way switch, and the `service_type` pgEnum is asserted
against the tuple at import. Every registry write takes an optional
`DbExecutor` (`db` or an open transaction, exported from `db/index.ts`) so
related row writes commit together while Swarm, Traefik and file side effects
stay outside the transaction, where they remain best-effort.

## Realtime & background work

- `apps/web/server.ts` hosts the WebSocket endpoints:
  - `/ws/logs` — `docker logs -f` for a service (raw text + JSON control
    frames `{type:"empty"}` / `{type:"error"}`).
  - `/ws/deployment` — live build log of one deployment
    (`{type:"log"|"finish"|"error"}` frames), followed by byte offset from the
    log file on the config volume.
  - `/ws/events` — one org-scoped push stream per tab: `deployment` status
    transitions, `queue` depth and `service-status` corrections, plus a
    heartbeat. The panel maps a frame onto TanStack Query invalidations
    (`hooks/use-live-events.ts`), so dashboard screens carry no
    `refetchInterval` of their own — only a fallback while the socket is down.
  - `/ws/stats` — per-second container stats frames
    (`{cpu, memory:{used,total,percent}, network:{rx,tx}}`).
  - `/ws/terminal` — interactive exec into a container.
- Deployments run through a **durable queue**: the `deployment` table is the
  queue and the claim loop takes rows with `FOR UPDATE SKIP LOCKED`. Statuses
  transition `queued → running → done|error|cancelled`, stream over
  `/ws/deployment` and are published on `/ws/events`.
- node-schedule crons drive scheduled backups, scheduled deploys, metrics,
  uptime probes, the status reconciler and Docker cleanup. They are started by
  whichever process holds the worker role — `server.ts` in a default install,
  `worker.ts` in a split one.

## Infrastructure assumptions

- Docker **Swarm** mode (single node is fine): applications run as swarm
  services, compose as `docker compose` / `docker stack deploy`.
- **Network segmentation** (full detail in [`hardening.md`](./hardening.md)):

  | Overlay | Members |
  | --- | --- |
  | `nixploy-internal` | `nixploy`, `nixploy-worker` (split installs), `nixploy-postgres`, `nixploy-traefik` — no tenant workload, ever |
  | `nixploy-network` (`NIXPLOY_NETWORK`) | `nixploy-traefik` + tenant services **that have a domain** |
  | `<env-slug>-<env-id8>-net` | every application / database / compose service of one environment |
  | `<appName>-net` | the services of one compose stack |

  ```
                            :80/:443
                               │
                      ┌────────▼─────────┐
                      │  nixploy-traefik │
                      └───┬──────────┬───┘
          nixploy-internal│          │nixploy-network
               ┌──────────▼──┐    ┌──▼───────────────────────────┐
               │   nixploy   │    │ routed tenant services only  │
               └──────┬──────┘    └──┬────────────────────┬──────┘
                      │              │                    │
            ┌─────────▼───────┐  ┌───▼──────────────┐ ┌───▼──────────────┐
            │ nixploy-postgres│  │ production-…-net │ │ staging-…-net    │
            └─────────────────┘  │ app · db · stack │ │ app · db · stack │
                                 └──────────────────┘ └──────────────────┘
  ```

  The environment overlay is created before a deploy and removed after the
  last service of the environment is deleted. Membership of `nixploy-network`
  is derived from the domain rows, so adding the first domain attaches it and
  removing the last one detaches it (`syncApplicationSharedNetwork`). Managed
  databases never join it — the panel talks to them with `docker exec`.
- Every tenant `ContainerSpec` carries the baseline hardening (`CapabilityDrop:
  ALL` + a minimal add-set, `NoNewPrivileges`, `Pids` 1024, `nofile` 65536,
  rotating json-file logs, quota-derived CPU/memory limits) — see
  [`hardening.md`](./hardening.md).
- Traefik v3 runs as the global swarm service `nixploy-traefik`, publishing
  host ports 80/443, configured through the **file provider** watching the
  dynamic dir under `NIXPLOY_CONFIG_DIR` (default `/etc/nixploy`, dev default
  `.nixploy-data/`). See `docs/domains-traefik.md`.
- Remote servers are driven over SSH (`execAsyncRemote(serverId)`) for
  everything that happens *on* the node — builds, image pulls, container
  exec/logs/stats, file mounts, volume removal, plain `docker compose`. Swarm
  **service** objects (create/update/inspect/scale/rm, stack deploy, status
  reads) are always issued to the primary manager; a service pinned to a
  server carries `node.id==<server.swarm_node_id>` in its placement
  constraints so its tasks land where the image and the data volume live
  (`modules/cluster/placement.ts`, `modules/cluster/swarm-node.ts`). Setup
  joins them to the **primary** Swarm as a worker or manager — they do not
  run an isolated `swarm init`. Traefik stays cluster-wide on managers.
  Every docker/shell call has a local/remote duality.
