# syntax=docker/dockerfile:1

# Nixploy main app image: builds the pnpm monorepo and runs apps/web via the
# custom server (WebSockets, deploy queue, crons). Traefik is expected as a
# sibling Swarm service — set NIXPLOY_DISABLE_TRAEFIK_BOOT=1 in production.

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10 --activate

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/server/package.json packages/server/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	pnpm install --frozen-lockfile

# ---- Build ----
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Build-only output is removed here, in the stage the runner copies from —
# an `rm` in a later layer would not shrink the image:
#   .next/cache       compiler cache
#   .next/standalone  unused (the custom server runs from the full tree)
#   .next/dev         dev-server artefacts
RUN pnpm --filter @nixploy/web build \
	&& rm -rf /app/apps/web/.next/cache /app/apps/web/.next/standalone /app/apps/web/.next/dev

# ---- Runtime ----
# Plain node image: nothing at runtime goes through pnpm/corepack, so the panel
# boots without registry access (corepack would otherwise download the pinned
# pnpm on every container start).
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LISTEN_HOST=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NIXPLOY_MIGRATIONS_DIR=/app/packages/server/drizzle
ENV NIXPLOY_DISABLE_TRAEFIK_BOOT=1
# Surfaced in Settings → Updates. install.sh / update.sh / CI pass --build-arg.
ARG NIXPLOY_APP_VERSION=0.1.0
ENV NIXPLOY_APP_VERSION=$NIXPLOY_APP_VERSION
# Optional git SHA for /api/version (`--build-arg NIXPLOY_GIT_COMMIT=$(git rev-parse HEAD)`).
ARG NIXPLOY_GIT_COMMIT=""
ENV NIXPLOY_GIT_COMMIT=$NIXPLOY_GIT_COMMIT

# Docker CLI talks to the host socket (Swarm, builds, logs).
# git/openssh used when cloning app sources during deploys.
# curl: HEALTHCHECK below. postgresql-client: instance backups prefer local pg_dump.
# docker-cli-buildx: `docker buildx build`, the local layer cache and BuildKit
# secrets — without it EVERY source build fails ("the buildx component is missing").
# tzdata: without the zoneinfo database Alpine ignores TZ and every cron
# (backups, schedules, platform alerts) silently runs in UTC.
RUN apk add --no-cache docker-cli docker-cli-buildx docker-cli-compose git openssh-client openssl curl postgresql-client tzdata

# Migration runner with its own small node_modules (does not share the app tree).
# The manifest and lockfile are vendored in docker/migrate-deps/ so the whole
# tree — not just the two top-level packages — is pinned and integrity-checked
# on every build (security.md §2.8: `npm install pkg@version` left the
# transitive set floating). Versions mirror what packages/server resolves in
# pnpm-lock.yaml; regenerate with
#   (cd docker/migrate-deps && npm install --package-lock-only --omit=dev --ignore-scripts)
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/migrate.mjs /app/migrate-deps/migrate.mjs
COPY docker/migrate-deps/package.json docker/migrate-deps/package-lock.json /app/migrate-deps/
RUN chmod +x /app/entrypoint.sh \
	&& cd /app/migrate-deps \
	&& npm ci --omit=dev --ignore-scripts \
	&& rm -rf /root/.npm /tmp/* \
	# npm itself is build-time only here (pnpm comes from corepack, migrations run
	# with node); its bundled node-tar carried a CRITICAL in the image scan.
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Root is required for the mounted docker.sock (same pattern as most PaaS images).
# Only what the custom server needs: the workspace symlinks in
# apps/web/node_modules and packages/server/node_modules resolve into
# /app/node_modules/.pnpm, so the layout must stay /app-rooted. apps/landing,
# apps/cli and tools/ are not shipped.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/server /app/packages/server
COPY --from=build /app/apps/web /app/apps/web

WORKDIR /app/apps/web
EXPOSE 3000

# Swarm keeps a task out of the service VIP until this passes and, with
# --update-failure-action rollback (install.sh / update.sh), rolls a failing
# update back. /api/ready answers 503 when Postgres, the docker socket or the
# migration state is broken (see packages/server/src/modules/observability/health.ts);
# the generous start period covers a cold host where migrations wait for
# Postgres to come up.
# $PORT, not a literal: `nixploy-worker` (NIXPLOY_ROLE=worker) serves the same
# /api/health, /api/ready and /api/version on its own port instead of 3000.
HEALTHCHECK --interval=15s --timeout=10s --start-period=180s --retries=3 \
	CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/ready" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
# tsx straight from the workspace install (pnpm shim with absolute NODE_PATH).
# One command for every role: `server.ts` hands over to the worker entry point
# when NIXPLOY_ROLE=worker, so a split install only sets an env var.
CMD ["/app/apps/web/node_modules/.bin/tsx", "server.ts"]
