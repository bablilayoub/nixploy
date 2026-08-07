# Contributing to Nixploy

Thanks for helping. This guide is the shortest path from clone → running app → open PR.

Deeper conventions (tenancy, routers, secrets) live in [`AGENTS.md`](./AGENTS.md). Local env details: [`docs/development.md`](./docs/development.md).

## What to work on

1. Bugs and UX polish beat speculative features.
2. Check [`docs/next.md`](./docs/next.md) and [`docs/hardening.md`](./docs/hardening.md) before starting large cleanup.
3. Open an issue (or comment on an existing one) if the change is big or unclear — saves rework.

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | ≥ 22 |
| pnpm | ≥ 10 (`corepack enable`) |
| Docker | Daemon running; Swarm active |

```bash
docker info --format '{{.Swarm.LocalNodeState}}'
# if not "active":
docker swarm init
```

## 5-minute setup

```bash
git clone https://github.com/bablilayoub/nixploy.git
cd nixploy
pnpm install

# App database (keep this container around between sessions)
docker run -d --name nixploy-dev-pg \
  -e POSTGRES_USER=nixploy -e POSTGRES_PASSWORD=nixploy -e POSTGRES_DB=nixploy \
  -p 54329:5432 postgres:17-alpine

cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env` (or paste these and adjust):

```bash
DATABASE_URL=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy
BETTER_AUTH_SECRET=$(openssl rand -hex 24)
ENCRYPTION_KEY=$(openssl rand -hex 16)
BETTER_AUTH_URL=http://localhost:3000
NIXPLOY_CONFIG_DIR=$(pwd)/.nixploy-data
```

```bash
pnpm db:migrate
cd apps/web && pnpm dev
```

Open **http://localhost:3000/setup** and create the first user (that creates your org).

Optional marketing site:

```bash
cd apps/landing && pnpm dev   # http://localhost:3001
```

## Where code lives

| Path | Change this when… |
| --- | --- |
| `apps/web` | UI, pages, tRPC client usage |
| `packages/server` | Schema, tRPC routers, deploy engine, Docker/Traefik |
| `apps/cli` | CLI commands |
| `apps/landing` | nixploy.com marketing |
| `docs/` | Operator / contributor guides |

New tRPC routers go in `packages/server/src/trpc/routers/` and **must** be registered in `packages/server/src/trpc/root.ts`.

## Before you open a PR

From the repo root:

```bash
pnpm exec biome check --write <your-files>
pnpm -F @nixploy/server exec tsc --noEmit
# if you touched apps/web:
cd apps/web && pnpm exec tsc --noEmit
pnpm test
```

**Rules of thumb**

- Prefer a small, focused PR over a kitchen-sink branch.
- Match existing style (Biome: tabs, double quotes, named exports).
- Tenant data: always resolve org via `resolveCallerOrganizationId` / helpers — never trust raw `activeOrganizationId`.
- Secrets: `encryptedText` columns only; don’t log tokens.
- Shell/Docker: use `execAsync` / `execAsyncRemote` — not raw `child_process`.
- Paths under config dir: helpers in `paths.ts`, not hardcoded `/etc/nixploy`.
- Schema changes: edit Drizzle → `pnpm db:generate` → commit the migration.
- Don’t run `pnpm install` inside a single workspace package — always at the repo root.
- Don’t add dependencies unless the PR needs them and you say why.

## PR checklist

- [ ] Title describes *why* (e.g. `fix: redact env on application.move`)
- [ ] Linked issue if there is one
- [ ] Tests / typecheck / biome clean for the area you touched
- [ ] UI: quick pass in light **and** dark mode when you change screens
- [ ] No secrets, `.env`, or local data in the diff

## Questions

- Product intent: [`PLAN.md`](./PLAN.md)
- Docs index: [`docs/README.md`](./docs/README.md)
- Issues / PRs: [github.com/bablilayoub/nixploy](https://github.com/bablilayoub/nixploy)

Welcome aboard.
