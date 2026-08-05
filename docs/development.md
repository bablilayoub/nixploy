# Development setup

## Prerequisites

- Node ≥ 22, pnpm ≥ 10 (`corepack enable` gives you the pinned pnpm).
- Docker Desktop (or any Docker daemon) with **Swarm active**:
  `docker swarm init` once if `docker info | grep Swarm` says `inactive`.
- A local PostgreSQL 17 for the app database. Quickest throwaway instance:

```bash
docker run -d --name nixploy-dev-pg \
  -e POSTGRES_USER=nixploy -e POSTGRES_PASSWORD=nixploy -e POSTGRES_DB=nixploy \
  -p 54329:5432 postgres:17-alpine
```

(`docker/docker-compose.dev.yml` can instead boot Postgres **and** the full
app in containers — useful for smoke-testing the production image.)

## Environment

`apps/web/.env` (see `apps/web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | App database, e.g. `postgres://nixploy:nixploy@127.0.0.1:54329/nixploy` |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth signing + base URL (`http://localhost:3000`) |
| `ENCRYPTION_KEY` | AES key for `encryptedText` columns (env vars, DB passwords, tokens) |
| `NIXPLOY_CONFIG_DIR` | Where app code, compose files, logs and Traefik dynamic YAML live. Dev default: `.nixploy-data/` at the repo root; production: `/etc/nixploy` |
| `NIXPLOY_NETWORK` | Shared overlay network name (default `nixploy-network`) |

## Run

```bash
pnpm install
pnpm db:migrate                 # apply Drizzle migrations to DATABASE_URL
cd apps/web && pnpm dev         # http://localhost:3000 (loads .env itself)
```

First run: open `/setup` on a fresh database to create the owner account
(public `/register` is removed). An organization `<name>'s Org` is created
during setup and becomes your active org. The dev server boots
Traefik (`nixploy-traefik` swarm service) and the overlay network
automatically on start.

## Verify changes (the loop)

```bash
pnpm -F @nixploy/server exec tsc --noEmit      # server types
cd apps/web && pnpm exec tsc --noEmit          # web types
pnpm exec biome check --write <changed files>  # lint/format (repo root)
pnpm test                                      # vitest (packages/server)
cd apps/web && pnpm build                      # full production build (before shipping UI work)
```

For UI changes, also drive the real app headlessly with Playwright
(`playwright-core`): log in, exercise the flow, screenshot the surfaces you
touched in light and dark mode. Ask before `pnpm install`-ing inside a single
workspace package — run installs at the repo root so workspace symlinks stay
intact.

Minimal smoke (optional; requires `playwright-core` + Chromium):

```bash
# pnpm add -Dw playwright-core && npx playwright-core install chromium
BASE_URL=http://localhost:3000 node apps/web/e2e/smoke.mjs
# Fresh DB → /setup; existing users → set SMOKE_EMAIL / SMOKE_PASSWORD
```

## Useful debugging handles

- Traefik dynamic configs: `$NIXPLOY_CONFIG_DIR/traefik/dynamic/<appName>.yml`
  (hot-reloaded by the file provider — edit via the app, not by hand).
- App build dirs and logs: `$NIXPLOY_CONFIG_DIR/applications/<appName>/`.
- Database: `pnpm db:studio` for Drizzle Studio.
- REST API: `/swagger` for OpenAPI docs; authenticate with `x-api-key`
  (create keys in Settings → Profile → API keys).

## Docs map

`docs/architecture.md` · `docs/development.md` · `docs/deployment-flow.md` ·
`docs/domains-traefik.md` · `docs/auth.md` · `docs/audit.md` · `docs/docker.md` ·
`docs/observability.md` · `docs/templates.md`
