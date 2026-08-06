# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## What this is

Nixploy is a self-hosted PaaS: pnpm monorepo with a Next.js app, a CLI, and a shared server package that contains the deploy engine (Docker Swarm + Traefik). Marketing site: [nixploy.com](https://nixploy.com). See `README.md` and `PLAN.md` for product context.

## Commands

```bash
pnpm install                    # install all workspace deps
pnpm build                      # build all packages/apps (pnpm -r build)
pnpm typecheck                  # tsc --noEmit across the workspace
pnpm lint / pnpm lint:fix       # Biome check / autofix
pnpm test                       # vitest across the workspace
pnpm db:migrate                 # apply Drizzle migrations (@nixploy/server)
pnpm db:generate                # generate a new migration after schema changes

# Scoped variants (prefer these when iterating)
pnpm -F @nixploy/server exec tsc --noEmit
pnpm -F @nixploy/cli typecheck
cd apps/web && pnpm build       # full Next.js production build
cd apps/web && pnpm dev         # dev server on :3000
```

## Monorepo layout

- `apps/web` — Next.js 16 (App Router) + Tailwind v4 + shadcn/ui. Custom server (`server.ts`) hosts websockets, the in-memory deploy queue and node-schedule crons. UI + tRPC + REST/OpenAPI + Swagger in one process.
- `apps/landing` — public marketing site at [nixploy.com](https://nixploy.com): Next.js 15 + Tailwind v4 + Motion. Runs on :3001 (`cd apps/landing && pnpm dev`).
- `apps/cli` — `@nixploy/cli`, talks to the REST API with `x-api-key`.
- `packages/server` — `@nixploy/server`: Drizzle schema, better-auth config, tRPC routers, deploy engine, builders, Traefik/Docker utils, backups, notifications.
- `docker/` — production Dockerfile, Traefik static config; `install.sh` at the root is the production installer.

## Conventions

- **tRPC routers** live in `packages/server/src/trpc/routers/<kebab-case>.ts`, export a `<name>Router`, and are merged in `packages/server/src/trpc/root.ts`. New routers must be registered there or they are unreachable (tRPC, REST and CLI all hang off the same root router).
- **Org-scoping**: every procedure that touches tenant data uses `protectedProcedure` from `trpc/init` and resolves the caller's org with `resolveCallerOrganizationId(ctx.session.user.id, ctx.session.session.activeOrganizationId)` from `modules/projects` (or the async `getOrganizationId` from `modules/application/org.ts`, which delegates to it). It falls back to the caller's first membership when the session has no active org — never read `activeOrganizationId` raw and never throw on it being null. Every query must still filter rows by the resolved org id.
- **Secrets at rest**: use the `encryptedText` column helper (AES, keyed by `ENCRYPTION_KEY`) for env vars, DB passwords, registry credentials, API tokens. Never store secrets in plain `text` columns.
- **Local/remote duality**: every docker/shell operation goes through `execAsync` (local) or `execAsyncRemote(serverId)` (SSH) from `@nixploy/server` exec utils — never call `child_process` directly in feature code.
- **Filesystem paths**: anything under the config dir resolves via `NIXPLOY_CONFIG_DIR` (default `/etc/nixploy`) — Traefik dynamic YAML, application code, compose files, logs, metrics history. Use the existing `paths.ts` helpers; do not hardcode `/etc/nixploy`.
- **Background crons** (registered in `apps/web/server.ts`): backup schedules, service schedules, `status-reconciler` (keeps service status truthful vs real container state), `metrics-history` (30s stats snapshots, 48h retention), `deployment-maintenance` (hourly: expire previews past `expiresAt`, prune deployment logs older than 30 days). At boot, `recoverInterruptedDeployments` marks deployments left `running` by a restart as failed.
- **Destructive/infrastructure mutations require roles**: `assertOrgRole(userId, orgId, "admin")` from `modules/projects`; record meaningful mutations to the audit log with `auditFromSession` (fire-and-forget).
- **UI data fetching**: `useTRPC()` from `@/lib/trpc` with `trpc.<router>.<proc>.queryOptions` / `mutationOptions`, and invalidate via `queryKey` after mutations. shadcn components live in `@/components/ui`; toasts via sonner.
- **Dependencies**: do not add new dependencies without discussion — the workspace dependency set is deliberately fixed.

## Validation loop

1. `pnpm -F @nixploy/server exec tsc --noEmit` after any server change.
2. `cd apps/web && pnpm exec tsc --noEmit` after any web change (fast); `cd apps/web && pnpm build` before shipping bigger UI work (needs env: `set -a && . ./.env && set +a`).
3. `pnpm exec biome check --write <changed files>` from the repo root — always, before considering a change done.
4. `pnpm test` (vitest in `packages/server`) for unit coverage of builders, Traefik YAML generation, template catalog and db utils.
5. Smoke test with Docker when touching the deploy path: boot the app against a local Postgres, deploy a docker-image application to the local Swarm, attach a domain, and confirm traffic flows through Traefik.
6. Browser verification with Playwright (`playwright-core`, headless Chromium) for UI changes — screenshot every surface you touched, in light AND dark mode. Dev logins live in the local dev database.

## Dev environment

- Requires Node ≥22, pnpm ≥10 and a running Docker daemon with Swarm active (`docker swarm init` if needed).
- Local Postgres: any instance works; `DATABASE_URL` in `apps/web/.env` points at it. `docker/docker-compose.dev.yml` can boot Postgres + the full app if you prefer containers.
- Apply schema with `pnpm db:migrate` (run in `packages/server` or from the root script), generate new migrations with `pnpm db:generate` after editing `packages/server/src/db/schema/*`.
- First user completes `/setup` on a fresh database (public `/register` is
  removed); an organization named `<name>'s Org` is created during setup.
- Detailed guides live in `docs/` (architecture, development setup, deployment flow, domains/Traefik, auth, audit & roles, docker control center, observability, templates).

## Notes

- Formatting/linting is Biome (tabs, see `biome.json`) — match it instead of reformatting.
- Database changes go through Drizzle: edit the schema, `pnpm db:generate`, commit the migration.
