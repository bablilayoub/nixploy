# syntax=docker/dockerfile:1

# Nixploy main app image: builds the pnpm monorepo and produces the
# Next.js standalone output of apps/web (UI + tRPC API).

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10 --activate

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app

# Copy only manifests first so this layer caches on dependency changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/server/package.json packages/server/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	pnpm install --frozen-lockfile

# ---- Build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @nixploy/server build || true
RUN pnpm --filter @nixploy/web build

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NIXPLOY_MIGRATIONS_DIR=/app/drizzle

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Docker CLI is required so the app can talk to the mounted host
# docker socket (swarm service create/update, builds, logs).
RUN apk add --no-cache docker-cli docker-cli-compose

# Next.js standalone output (set `output: "standalone"` in apps/web/next.config).
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# DB migrations + runner (entrypoint applies them before boot).
COPY --from=build --chown=nextjs:nodejs /app/packages/server/drizzle ./drizzle
COPY --chown=nextjs:nodejs docker/migrate.mjs /app/migrate-deps/migrate.mjs
COPY --chown=nextjs:nodejs docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
	&& cd /app/migrate-deps \
	&& npm init -y >/dev/null \
	&& npm pkg set type=module \
	&& npm install --omit=dev drizzle-orm@0.45.2 postgres@3.4.5 \
	&& chown -R nextjs:nodejs /app/migrate-deps

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
