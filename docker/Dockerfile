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
RUN pnpm --filter @nixploy/web build

# ---- Runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LISTEN_HOST=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NIXPLOY_MIGRATIONS_DIR=/app/packages/server/drizzle
ENV NIXPLOY_DISABLE_TRAEFIK_BOOT=1
# Surfaced in Settings → Updates. Overridden at build with --build-arg when needed.
ARG NIXPLOY_APP_VERSION=0.1.0
ENV NIXPLOY_APP_VERSION=$NIXPLOY_APP_VERSION

# Docker CLI talks to the host socket (Swarm, builds, logs).
# git/openssh used when cloning app sources during deploys.
RUN apk add --no-cache docker-cli docker-cli-compose git openssh-client curl

# Root is required for the mounted docker.sock (same pattern as most PaaS images).
COPY --from=build /app /app

# Drop build caches that are useless at runtime.
RUN rm -rf \
	/app/apps/web/.next/cache \
	/app/apps/web/.next/dev \
	/tmp/* \
	/root/.npm \
	/root/.cache

COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/migrate.mjs /app/migrate-deps/migrate.mjs
RUN chmod +x /app/entrypoint.sh \
	&& cd /app/migrate-deps \
	&& npm init -y >/dev/null \
	&& npm pkg set type=module \
	&& npm install --omit=dev drizzle-orm@0.45.2 postgres@3.4.5

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["pnpm", "--filter", "@nixploy/web", "exec", "tsx", "server.ts"]
