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
- `apps/landing` — public marketing site at [nixploy.com](https://nixploy.com): Next.js 16 + Tailwind v4 + Motion. Runs on :3001 (`cd apps/landing && pnpm dev`).
- `apps/cli` — `@nixploy/cli`, talks to the REST API with `x-api-key`.
- `packages/server` — `@nixploy/server`: Drizzle schema, better-auth config, tRPC routers, deploy engine, builders, Traefik/Docker utils, backups, notifications.
- `docker/` — production Dockerfile, Traefik static config; `install.sh` at the root is the production installer.

## Conventions

- **tRPC routers** live in `packages/server/src/trpc/routers/<kebab-case>.ts`, export a `<name>Router`, and are merged in `packages/server/src/trpc/root.ts`. New routers must be registered there or they are unreachable (tRPC, REST and CLI all hang off the same root router).
- **Org-scoping**: every procedure that touches tenant data uses `protectedProcedure` from `trpc/init` and resolves the caller's org with `resolveCallerOrganizationId(ctx.session.user.id, ctx.session.session.activeOrganizationId)` from `modules/projects` (or the async `getOrganizationId` from `modules/application/org.ts`, which delegates to it). It falls back to the caller's first membership when the session has no active org — never read `activeOrganizationId` raw and never throw on it being null. Every query must still filter rows by the resolved org id.
- **Project scoping**: on top of the org axis, a member whose `member.project_scope` is `teams` only reaches the projects their teams are attached to. `protectedProcedure` resolves the filter once per request and puts it in an `AsyncLocalStorage` store (`modules/projects/project-scope.ts`), so the existing funnels (`findProjectById`, `assertApplicationAccess`, `assertEnvironmentAccess`, `getServiceContext`) enforce it for free. A **new list procedure must declare its project axis** in `trpc/tenancy-coverage.ts` (`PROJECT_AXIS`: `filtered` / `inherited` / `exempt`) or CI fails — and that includes counters and search, which leak just as much as a list. A hidden project is `NOT_FOUND`, never `FORBIDDEN`. Absence of the store means unrestricted, which is what keeps crons and the worker working.
- **Forward auth**: the `nixployAuth` domain middleware puts a tenant host behind the panel login. Policy in `modules/app-auth/policy.ts` (pure), tokens in `tokens.ts` (HMAC over the `ENCRYPTION_KEYS` chain, host-bound), routes in `apps/web/src/app/{api/app-auth/verify,app-auth/authorize,%5Fnixploy/callback}`. The `%5F` is required — Next does not route a folder starting with `_`. Every decision fails closed.
- **Secrets at rest**: use the `encryptedText` column helper (AES, keyed by `ENCRYPTION_KEY`) for env vars, DB passwords, registry credentials, API tokens. Never store secrets in plain `text` columns.
- **Local/remote duality**: every docker/shell operation goes through `execAsync` (local) or `execAsyncRemote(serverId)` (SSH) from `@nixploy/server` exec utils — never call `child_process` directly in feature code.
- **Filesystem paths**: anything under the config dir resolves via `NIXPLOY_CONFIG_DIR` (default `/etc/nixploy`) — Traefik dynamic YAML, application code, compose files, logs, metrics history. Use the existing `paths.ts` helpers; do not hardcode `/etc/nixploy`.
- **Background crons** (registered in `apps/web/server.ts`): backup schedules, service schedules, `status-reconciler` (keeps service status truthful vs real container state), `metrics-history` (30s stats snapshots, 48h retention), `deployment-maintenance` (hourly: expire previews past `expiresAt`, prune deployment logs older than 30 days). The `deployment` table is the queue (`queued` rows claimed with `FOR UPDATE SKIP LOCKED`, one running job per app); at boot `recoverInterruptedDeployments` fails rows left `running` by a restart and the worker claims the queued backlog. Also registered: `platform-alerts` (5 min), docker image auto-update (hourly), uptime probes.
- **Destructive/infrastructure mutations require roles**: `assertOrgRole(userId, orgId, "admin")` from `modules/projects`; record meaningful mutations to the audit log with `auditFromSession` (fire-and-forget).
- **UI data fetching**: `useTRPC()` from `@/lib/trpc` with `trpc.<router>.<proc>.queryOptions` / `mutationOptions`, and invalidate via `queryKey` after mutations. shadcn components live in `@/components/ui`; toasts via sonner.
- **UI conventions**: sentence case for every label, button and dialog title (proper nouns keep their capitals); errors through `toastError` / `describeError`, never `toast.error(error.message)`. Service pages (application, compose, the five databases) all render `components/services/service-page-header.tsx` with one tab order — General · [Compose file | Connection] · Deploy · Runtime · Domains · Environment · Backups · Advanced · Settings — URL-synced by `useSyncedTab`; retire a tab id only by adding it to `SERVICE_TAB_ALIASES`. Deployment state comes from the single `hooks/use-running-deployments.ts` query (no extra `refetchInterval`s); other long operations register with `components/layout/activity-tray.tsx`.
- **Errors**: modules throw `DomainError` (`modules/errors.ts` helpers `badRequest` / `notFound` / `conflict` / `forbidden` / `preconditionFailed` / `timeout`), never `TRPCError` (Biome blocks `@trpc/server` under `modules/**`); `trpc/init.ts` is the single mapping point and REST/MCP inherit it. Best-effort teardown goes through `bestEffort(label, fn)` (`utils/best-effort.ts`).
- **Service kinds**: never hand-write the seven-way `application | compose | postgres | mysql | mariadb | mongo | redis` union or a `switch` over it — import `SERVICE_KINDS` / `ServiceKind` from `modules/services/kinds` (import-free, bundled by the panel) and dispatch through `SERVICE_REGISTRY[kind]` (`modules/services/registry`); zod inputs use `serviceKindSchema` / `databaseKindSchema`.
- **Transactions**: multi-row writes take `executor: DbExecutor = db` (from `db/index.ts`) and the caller wraps them in `db.transaction(...)`; Swarm, Traefik and file side effects stay outside (best-effort, not rollback-able).
- **Egress**: outbound requests to user-controlled hosts (notification providers, SMTP, git providers, registries, S3, uptime probes, template sources) go through the guards in `utils/public-url.ts` — `assertSafeOutboundUrl` / `assertPublicHttpsUrl` / `assertSafeSmtpHostname` / `assertSafeGitCloneUrl` return a `SafeTarget` (`{ url, addresses, isPrivate }`) and `pinnedFetch(target, init)` dials only those addresses (never global `fetch` on a tenant URL, never connect to `url.hostname` after the check — that reopens DNS rebinding). `allowPrivate: true` at a call site is a request ANDed with the instance toggle `webServer.allowPrivateEgress` (default off); the Swarm overlay `10.0.0.0/8` and platform service names are never reachable.
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
- Detailed guides live in `docs/` — start at [`docs/README.md`](docs/README.md). File-level map: [`docs/codebase-map.md`](docs/codebase-map.md). Living backlog + health snapshot: [`docs/status.md`](docs/status.md) (update it after every work session). Completed phase checklists (Phase 9 hardening, Phase 10) are archived under `docs/archive/`.
- Check `docs/status.md` before starting cleanup work so two people don't fix the same thing.

## Notes

- Formatting/linting is Biome (tabs, see `biome.json`) — match it instead of reformatting.
- Database changes go through Drizzle: edit the schema, `pnpm db:generate`, commit the migration.
