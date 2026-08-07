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

## Request surfaces (one process)

```
Browser ──► apps/web (Next.js App Router)              UI
   │
   ├────► /api/trpc/*        tRPC fetch handler ──► packages/server routers
   ├────► /api/auth/*        better-auth handler
   ├────► /api/<router>.<proc>  REST/OpenAPI wrapper over the same root router (x-api-key)
   ├────► /swagger           generated OpenAPI docs
   └────► /ws/{logs,deployment,stats,terminal}   WebSocket streams (server.ts)
```

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
  - `backups/`, `schedules/`, `notifications/`, `git/`, `cluster/`,
    `templates/` — see their READMEs/tests.

## Realtime & background work

- `apps/web/server.ts` hosts the WebSocket endpoints:
  - `/ws/logs` — `docker logs -f` for a service (raw text + JSON control
    frames `{type:"empty"}` / `{type:"error"}`).
  - `/ws/deployment` — live build log of one deployment
    (`{type:"log"|"finish"|"error"}` frames).
  - `/ws/stats` — per-second container stats frames
    (`{cpu, memory:{used,total,percent}, network:{rx,tx}}`).
  - `/ws/terminal` — interactive exec into a container.
- Deployments run through an **in-process queue** (one at a time per service)
  started by `queueDeployment`; statuses transition
  `queued → running → done|error` and are streamed over `/ws/deployment`.
- node-schedule crons (started in `server.ts`) drive scheduled backups,
  scheduled deploys and Docker cleanup.

## Infrastructure assumptions

- Docker **Swarm** mode (single node is fine): applications run as swarm
  services, compose as `docker stack deploy`, everything attaches to the
  shared overlay network `NIXPLOY_NETWORK` (default `nixploy-network`).
- Traefik v3 runs as the global swarm service `nixploy-traefik`, publishing
  host ports 80/443, configured through the **file provider** watching the
  dynamic dir under `NIXPLOY_CONFIG_DIR` (default `/etc/nixploy`, dev default
  `.nixploy-data/`). See `docs/domains-traefik.md`.
- Remote servers are driven over SSH (`execAsyncRemote(serverId)`). Setup
  joins them to the **primary** Swarm as a worker or manager — they do not
  run an isolated `swarm init`. Traefik stays cluster-wide on managers.
  Every docker/shell call has a local/remote duality.
