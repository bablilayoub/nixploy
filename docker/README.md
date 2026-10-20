# docker/

Container packaging for Nixploy.

- `Dockerfile` — multi-stage build of the pnpm monorepo; the runner ships only
  `apps/web`, `packages/server` and production workspace dependencies (no
  `apps/landing`, `apps/cli`, `tools/`, `.next/cache` or `.next/standalone`)
  and starts `tsx server.ts` directly (no pnpm/corepack at boot, so the panel
  starts without registry access). Entrypoint applies Drizzle migrations
  before boot. A `HEALTHCHECK` on `/api/ready` lets Swarm gate readiness
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

The dependency stage installs production packages independently, then
`prune-runtime-deps.mjs` follows the web/server runtime dependency graph while
omitting three build-only peers: TypeScript, Drizzle Kit and Vitest. Their
exclusive children, including the unused native compilers, are absent from
the runner. tsx and its native esbuild remain available for the custom server,
worker and encryption-key rotator. Package versions and peer settings are not
rewritten; a newly declared direct runtime dependency on an omitted tool fails
the image build for review.

The image’s migration runner is `node /app/migrate-deps/migrate.mjs` (the
entrypoint already runs it for the combined/worker role). Schema generation,
TypeScript checks, UI compilation and `pnpm db:*` are source-checkout commands.
The production key-rotation command is in [auth.md](../docs/auth.md#encryption-key-rotation).
The separately distributed CLI remains built and packaged by `apps/cli`.

CI and both publication workflows pull the base and pass a fresh
`NIXPLOY_APK_REFRESH` value per run/attempt, invalidating only the Alpine
installation layer and its descendants. A local security refresh can use
`docker build --pull --build-arg NIXPLOY_APK_REFRESH=2026-10-20 -f docker/Dockerfile .`.
The minimum libexpat is 2.9.0-r0. Native amd64/arm64 scans retain all severities;
HIGH/CRITICAL findings stop the build/publication path without excluding
unfixed advisories. See the [runtime audit](../docs/audits/2026-10/runtime-image.md).
