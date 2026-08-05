# docker/

Container packaging for Nixploy.

- `Dockerfile` — multi-stage build of the pnpm monorepo; runs `apps/web` via
  the custom `server.ts` (WebSockets, deploy queue, crons). Entrypoint
  applies Drizzle migrations before boot. Published as
  `ghcr.io/bablilayoub/nixploy` by `.github/workflows/docker.yml`.
- `entrypoint.sh` / `migrate.mjs` — production migrate-then-start helpers.
- `docker-compose.dev.yml` — local dev stack (PostgreSQL 17 + app).
  Run from the repo root:
  `docker compose -f docker/docker-compose.dev.yml up --build`
- `traefik/traefik.yml` — Traefik v3 static config template. `install.sh`
  copies it to `/etc/nixploy/traefik/traefik.yml` and the `nixploy-traefik`
  swarm service mounts it. The file provider hot-reloads per-app routing
  YAML from `/etc/nixploy/traefik/dynamic/`.

For production installs use `install.sh` at the repo root: OS detection,
Docker install, Swarm, secrets under `/etc/nixploy/.env`, then Swarm
services. Open `/setup` once to create the owner account.
