# Nixploy — Dokploy-Replica Build Plan

A free, self-hostable PaaS that simplifies deployment and management of applications and databases — a faithful functional replica of [Dokploy](https://github.com/dokploy/dokploy) (v0.29.x, Apache-2.0 core).

## Status (Aug 2026)

**Phases 1–5 are shipped.** The product surface in routers, UI, deploy engine, templates, CLI/API, audit, Docker control center and observability matches (and in places exceeds) the original roadmap. Audit logs were implemented despite being listed as out of scope below.

**Phases 6–7 are shipped too**: marketed features are truthful end-to-end (preview PR lifecycle with PR comments, primary-swarm remote join, production installer, cascading infra deletes), and a security/correctness pass closed the cross-tenant, injection and secret-leak gaps listed below.

**Phase 8 is shipped** — reliability (template image CI + Traefik golden-path smoke), Deploy Copilot close-the-loop (explain → apply env → redeploy, auto-explain on failure), multi-server placement + capacity, and GitOps-lite (URL sync + apply with redeploy).

**Phase 9 is complete — polish only (no new features).** Checklist archive: [`docs/archive/hardening.md`](docs/archive/hardening.md). Docs index: [`docs/README.md`](docs/README.md).

**Phase 10 is done** — permissions, tags, AI compose, CLI depth. Checklist: [`docs/archive/next.md`](docs/archive/next.md). Deferred: SSO/SCIM, Stripe, build-server role, Redis, K8s.

## 1. Tech Stack (decided)

Dokploy's own stack is proven for exactly this product, so we replicate it — with Tailwind CSS + shadcn/ui as required.

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces** (`apps/*`, `packages/*`) | Matches Dokploy; share server logic |
| Frontend | **Next.js 16 (App Router) + React 19 + TypeScript** | One process serves UI + API + WS |
| Styling | **Tailwind CSS v4 + shadcn/ui (Radix)** | Per requirements |
| Data fetching | **TanStack Query** (via tRPC client) | Server-state caching |
| API | **tRPC v11 + zod v4 + superjson**, plus REST/OpenAPI generation + Swagger UI | Type-safe internal API that also produces the public REST API for API keys/CLI |
| DB / ORM | **PostgreSQL + Drizzle ORM** (drizzle-kit migrations, drizzle-zod) | Lightweight, SQL-first |
| Auth | **better-auth** (organization, admin, twoFactor, api-key plugins) + bcrypt | Org-based multi-tenancy out of the box |
| Container engine | **Docker Swarm (single-node default) via dockerode**; remote servers over **ssh2** | Swarm rolling updates = free zero-downtime |
| Reverse proxy | **Traefik v3**, file provider (static `traefik.yml` + per-app dynamic YAML) | Hot-reload routing, ACME/Let's Encrypt built in |
| Queue | **Custom in-memory FIFO queue** with per-server concurrency (no Redis/BullMQ for self-hosted) | Dokploy self-hosted does the same |
| Cron | **node-schedule** | Backups, schedules, cleanup |
| Realtime | **ws** websocket server: deployment logs, container logs, docker stats, web terminal (xterm.js + node-pty) | |
| Email | nodemailer / Resend + react-email | Notifications |
| Git | octokit (GitHub App), simple-git / isomorphic-git for generic git | Auto-deploys |
| Misc | CodeMirror 6 (file/compose editors), Recharts (metrics), Biome (lint/format), Vitest (unit), Playwright (e2e) | |

## 2. Architecture Overview

One Node process (custom Next.js server via tsx, bundled with esbuild) + 3 sibling containers on a single-node Swarm:

```
┌───────────────────────────── Host (Docker Swarm manager) ─────────────────────────────┐
│  nixploy (Next.js app)   nixploy-postgres   nixploy-traefik (:80/:443)                 │
│         │ writes dynamic YAML ──────────────▶ /etc/nixploy/traefik/dynamic/*.yml       │
│         │ dockerode / ssh2 ▶ docker service create|update (user apps, DBs, compose)    │
│  overlay network: nixploy-network                                                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
Remote servers: SSH in, install Docker, join the primary Swarm (worker or manager).
Traefik stays cluster-wide on managers — remotes do not run an isolated swarm.
```

**Deploy pipeline** (the heart of the product):
1. tRPC mutation → create `deployment` row → enqueue job in in-memory queue (cancellable while pending, per-server concurrency).
2. Worker clones repo / downloads zip / pulls image into `/etc/nixploy/applications/<appName>/code`.
3. Build via selected builder (nixpacks / railpack CLI → Dockerfile, plain Dockerfile, buildpacks, or static→nginx); log streamed over WS and persisted on the deployment row.
4. `docker service create/update` with env, mounts, ports, resource limits, replicas, update/rollback config.
5. Write Traefik file-provider YAML per domain (routers, services, middlewares, TLS resolver) — Traefik hot-reloads.
6. Compose services: write `docker-compose.yml` + `.env`, run `docker compose -p <appName> up -d` or `docker stack deploy`.

## 3. Monorepo Layout

```
nixploy/
├─ apps/
│  ├─ web/            # Next.js app: UI + tRPC API routes + custom server (ws, queues)
│  └─ cli/            # @nixploy/cli — project/app/db/env management (npm bin)
├─ packages/
│  └─ server/         # @nixploy/server: db schema, auth, builders, traefik, docker utils, backups
├─ docker/            # Dockerfiles (app, traefik setup), install.sh
└─ package.json       # pnpm workspace root
```

OpenAPI/REST adapter lives in `packages/server/src/trpc/openapi.ts` (not a separate package).

## 4. Data Model (Drizzle)

Tenancy: `Organization → Project → Environment → Services`. Env vars inherit downward with per-level override. Better-auth tables: `user`, `member`, `session`, `account`.

Service tables (shared columns: appName, env, status, mounts, domains, resources):
- `application` — sourceType: `docker|git|github|gitlab|bitbucket|gitea|drop`; buildType: `dockerfile|heroku_buildpacks|paketo_buildpacks|nixpacks|static|railpack`; `isPreviewDeploymentsActive`; status: `idle|running|done|error`
- `compose` — sourceType + `raw` paste; composeType: `docker-compose|stack`
- `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

Supporting: `deployment`, `preview-deployment`, `rollback`, `domain`, `certificate`, `mount`, `port`, `redirect`, `security`, `registry`, `destination`, `backup`, `volume-backup`, `schedule`, `notification`, `server` (+ `swarmRole`), `ssh-key`, git provider tables, `tag`, `environment`, `web-server-settings`, `audit_log`.

Secrets at rest: encrypted column helper (AES) for env vars, DB passwords, registry creds.

## 5. Feature Roadmap (phased)

### Phase 1 — Foundation — DONE
- Repo scaffold, better-auth (email/password, orgs, roles, 2FA, API keys)
- Projects & environments CRUD; env-var inheritance
- Layout shell; `install.sh`

### Phase 2 — Applications — DONE
- Sources: generic git, GitHub/GitLab/Bitbucket/Gitea, docker image, drop
- Builders: nixpacks, railpack, dockerfile, static, heroku/paketo buildpacks
- Deploy queue + WS logs; Swarm upsert; Traefik domains + Let's Encrypt + traefik.me-style free domains
- Auto-deploy via provider webhooks + generic webhook

### Phase 3 — Databases & Compose — DONE
- postgres/mysql/mariadb/mongo/redis; compose/stack; S3 backups + volume backups

### Phase 4 — Operations — DONE
- Logs, terminal, stats; rollbacks; schedules; notifications; certificates; redirects; basic-auth; registries
- Preview deployments (manual + PR webhook lifecycle — see Phase 6)
- Audit log + Activity UI; Docker control center; command palette; metrics history; status reconciler

### Phase 5 — Scale & API surface — DONE
- Remote servers over SSH joining the primary Swarm (worker/manager)
- REST/OpenAPI + Swagger; `@nixploy/cli`; one-click templates gallery

### Phase 6 — Truthfulness & hardening — DONE
- Preview PR lifecycle: `isPreviewDeploymentsActive` + webhook open/sync/close → create/redeploy/delete
- `setupServer` joins primary swarm (no per-host `swarm init`)
- Production `install.sh` (OS deps, swarm, secrets, migrations) + first-admin `/setup`, public `/register` removed
- Cascade deletes tear down real infra (swarm services, volumes, Traefik YAML, on-disk state, logs) from environment → project → organization
- Docs/PLAN sync; Playwright smoke script

### Phase 7 — Security, correctness & polish — DONE
- Security: fail-closed GitLab/Gitea webhook auth; org-scoped generic deploy hook, docker/monitoring `serverId`, certificates and domain `certificateId`; admin gates on destructive infra ops; shell quoting in schedules/registries/ssh-keygen; secrets redacted from API responses; S3 access keys + notification configs encrypted at rest; auth rate limiting
- Correctness: boot recovery for interrupted deployments; hourly maintenance cron (preview `expiresAt` expiry, 30-day deployment log retention); logs removed with their service
- Features: preview URL commented back on the pull request (GitHub/GitLab/Gitea); Mattermost, Lark/Feishu and Microsoft Teams notification channels wired end to end
- UX: App Router error/global-error/not-found/loading boundaries; no-organization empty state with a create-org CTA; explicit terminal "start new session"; accessible names for icon-only actions

### Phase 8 — Beat Dokploy/Coolify (reliability + Copilot + templates) — DONE

Wins on **trust + speed + sharp edges**, not feature checklists.

- **Template hardening** — catalog image registry probes (`pnpm test:template-images`); CI fails on unpublished tags
- **Golden-path CI** — PR/main: biome + typecheck + vitest; Swarm + Traefik → whoami HTTP 200; `tools/golden-path-api.mjs` / `pnpm smoke:golden-path` for full API deploy→HTTP (workflow_dispatch + secrets)
- **Deploy Copilot close-the-loop** — Explain → Redeploy; auto-explain on failure (cached beside logs); **Apply env & redeploy** for KEY=VALUE patches
- **Multi-server** — Advanced → Placement constraints; servers list capacity (CPU/mem); drain via Docker → Swarm (linked from Servers)
- **GitOps-lite** — apply/sync redeploys changed apps/compose; **sync from HTTPS URL** (raw `nixploy.yaml`)

### Phase 9 — Polish (organize / harden / optimize) — DONE

No new features. Specs: [`docs/archive/hardening.md`](docs/archive/hardening.md).

Sprints: **A** DB indexes + org cache → **B** tenancy tests → **C** servers batch stats → **D** structure dedupe → **E** logger / landing typecheck / polling → **F** docs index + UX consistency.

### Phase 10 — Permissions, tags, AI compose, CLI — DONE

Checklist: [`docs/archive/next.md`](docs/archive/next.md).

- **A** Granular org capabilities (overrides on members; hot-path gates)
- **B** Tags UI (M2M + filter + manage/assign)
- **C** AI compose generation (draft only; user saves)
- **D** CLI compose/template depth + docs

**Still deferred / out of scope**
- Stripe billing, SSO/SCIM, libsql
- Dedicated build-server role beyond manager/worker (use placement constraints for affinity)
- Redis queue, Kubernetes; remote builder auto-provision
- New notification providers / template categories

## 6. UI Map (pages)

First-boot `/setup` → Login → Dashboard → Project → Environment →
- Application tabs: General, Domains, Deployments, Preview Deployments, Logs, Monitoring, Advanced, Settings
- Database tabs: General, Backups, Logs, Monitoring, Settings
- Compose tabs: General, Domains, Logs, Monitoring, Settings
→ Settings: Profile, Organization (General/Audit log/Incidents/Notifications), Servers, SSH keys, Platform, Certificates, Git providers, Registries, Backup storage
→ Templates, Docker control center, Swagger

## 7. Hardest Parts

1. **Builder matrix** — common Builder interface; nixpacks/railpack need host CLIs (or clear failure on remotes).
2. **Local/remote execution duality** — `execAsync` / `execAsyncRemote(serverId)`.
3. **Preview deployments** — wildcard DNS + PR lifecycle (webhook wiring and PR comments shipped).
4. **Permissions layer** — org roles (owner/admin/member); granular toggles later.
5. **Traefik config correctness** — port Dokploy's YAML-generation logic closely.

## 8. Validation

- Vitest for builder/traefik/db/webhook/preview/template/gitops/ai utils
- Template image health: `pnpm test:template-images` (also CI)
- GitHub Actions `ci.yml`: typecheck + vitest + Swarm/Traefik whoami smoke on PR/main
- API golden path: `pnpm smoke:golden-path` (needs `NIXPLOY_URL` + `NIXPLOY_API_KEY`)
- Playwright smoke: `apps/web/e2e/smoke.mjs` (requires `playwright-core`)
- Real acceptance: deploy a docker-image app on local Swarm and reach it over Traefik
