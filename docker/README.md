# docker/

Container packaging for Nixploy.

- `Dockerfile` — multi-stage build of the pnpm monorepo; the runner ships only
  `apps/web`, `packages/server` and the workspace `node_modules` (no
  `apps/landing`, `apps/cli`, `tools/`, `.next/cache` or `.next/standalone`)
  and starts `tsx server.ts` directly (no pnpm/corepack at boot, so the panel
  starts without registry access). Entrypoint applies Drizzle migrations
  before boot. A `HEALTHCHECK` on `/api/auth/ok` lets Swarm gate readiness
  and roll a failing update back (`install.sh` / `update.sh` pass
  `--update-failure-action rollback`). Published as
  `ghcr.io/bablilayoub/nixploy`: `main` + commit-sha tags by
  `.github/workflows/docker.yml`, `vX.Y.Z` + `latest` by
  `.github/workflows/release.yml` (see `docs/releases.md`).
- `entrypoint.sh` / `migrate.mjs` — production migrate-then-start helpers.
- `docker-compose.dev.yml` — local dev stack (PostgreSQL 17 + app) with
  dev-only auth/encryption defaults. Run from the repo root:
  `docker compose -f docker/docker-compose.dev.yml up --build`
- `traefik/traefik.yml` — reference copy of the Traefik v3 static config.
  `install.sh` / `update.sh` render the same content from an embedded
  heredoc and `packages/server/src/modules/traefik/setup.ts` regenerates it
  when settings change; CI diffs all of them against this file. The
  `nixploy-traefik` swarm service mounts the rendered file read-only and
  hot-reloads per-app routing YAML from `/etc/nixploy/traefik/dynamic/`.

For production installs use `install.sh` at the repo root: OS detection,
Docker install, Swarm, secrets under `/etc/nixploy/.env`, then Swarm
services. Open `/setup` once to create the owner account.
