# Development setup

Contributor overview (clone → PR): [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

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

Generate secrets once:

```bash
openssl rand -hex 24   # BETTER_AUTH_SECRET
openssl rand -hex 16   # ENCRYPTION_KEY
```

## Run

```bash
pnpm install
pnpm db:migrate                 # apply Drizzle migrations to DATABASE_URL
cd apps/web && pnpm dev         # http://localhost:3000 (loads .env itself)
```

Optional landing site: `cd apps/landing && pnpm dev` → http://localhost:3001.

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

## Continuous integration

Every pull request and push to `main` runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job | What it proves | Local equivalent |
| --- | --- | --- |
| **Checks** (reusable [`checks.yml`](../.github/workflows/checks.yml)) | `pnpm typecheck`, Biome, `pnpm test` with `DATABASE_URL_TEST` on a Postgres 17 service (tenancy suite included), Traefik static-config drift | the verify loop above, plus `DATABASE_URL_TEST=…` |
| **Build (web / landing / cli)** | `next build` for the panel and landing, `tsup` for the CLI — the panel builds with no env on purpose, like the Dockerfile | `pnpm -F @nixploy/web build` etc. |
| **Docker image + Trivy** | `docker/Dockerfile` builds (single-arch, not pushed, GHA cache) and a Trivy `CRITICAL,HIGH` scan — advisory (`exit-code: 0`) until the baseline is clean | `docker build -f docker/Dockerfile .` |
| **ShellCheck** | `install.sh`, `update.sh`, `docker/entrypoint.sh`, `tools/*.sh` at severity `warning` (0 findings today) | `shellcheck --severity=warning install.sh update.sh docker/entrypoint.sh tools/*.sh` |
| **pnpm audit** | `pnpm audit --prod --audit-level high` — `continue-on-error` until the known advisories are fixed | `pnpm audit --prod --audit-level high` |
| **Template image health**, **Swarm smoke** | Registry manifests for every template image; Traefik → whoami on a real Swarm; `install.sh`'s static config boots Traefik | `pnpm test:template-images` |
| **CodeQL** ([`codeql.yml`](../.github/workflows/codeql.yml)) | JavaScript/TypeScript static analysis on PRs, `main` and weekly | — |

The same `checks.yml` gates [`release.yml`](../.github/workflows/release.yml) on the tagged
ref before an image is built, so PR checks and the release gate cannot drift
([releases.md](./releases.md)). Superseded PR runs are cancelled; pushes to `main` always
finish. [Dependabot](../.github/dependabot.yml) opens weekly PRs for npm (minor/patch
grouped, `better-auth` excluded — bump it by hand), GitHub Actions and the Docker base image.

Validate workflow syntax locally with [`act`](https://github.com/nektos/act):
`act -l` lists every job and fails on YAML errors; `act -j shellcheck --dryrun` walks a job
without running it. Do not run the Docker/Postgres jobs under `act`.

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
