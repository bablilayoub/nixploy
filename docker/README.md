# docker/

Container packaging for Nixploy.

- `Dockerfile` — multi-stage build of the pnpm monorepo producing the Next.js
  standalone output of `apps/web`, plus an entrypoint that applies Drizzle
  migrations before boot. Requires `output: "standalone"` in
  `apps/web/next.config.*` and a `.dockerignore` at the **repo root**
  (at minimum: `node_modules`, `.next`, `.git`, `dist`).
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
