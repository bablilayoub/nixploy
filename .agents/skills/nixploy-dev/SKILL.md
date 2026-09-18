---
name: nixploy-dev
description: Develop, run and verify Nixploy (self-hosted PaaS) — dev setup, the verification loop, tenancy/auth rules, and how to add features (routers, pages, templates). Use when working in the nixploy monorepo.
---

# Nixploy development

Monorepo: `apps/web` (Next.js 16 + Tailwind v4 + shadcn, custom `server.ts`
with WS endpoints `/ws/{logs,deployment,stats,terminal}`, deploy queue, crons),
`apps/cli`, `packages/server` (Drizzle + better-auth + tRPC + deploy engine,
Docker Swarm + Traefik file provider).

## Run

```bash
pnpm install
pnpm db:migrate                 # needs DATABASE_URL (see apps/web/.env.example)
cd apps/web && pnpm dev         # http://localhost:3000
```

Requires Docker with Swarm active (`docker swarm init`). Traefik and the
`nixploy-network` overlay are auto-provisioned on boot. First user is created
at `/setup` on a fresh database (public `/register` is disabled after that).
Org `<name>'s Org` is created during setup.

## Verification loop (do this, in order, before declaring done)

1. `pnpm -F @nixploy/server exec tsc --noEmit` (server changes)
2. `cd apps/web && pnpm exec tsc --noEmit` (web changes)
3. `pnpm exec biome check --write <changed files>` from repo root
4. `pnpm test` — vitest in packages/server
5. UI work: drive the real app with Playwright (`playwright-core`, headless),
   login via the dev DB credentials, screenshot every touched surface in
   light AND dark mode. Watch the browser console for hydration warnings.

Production build before shipping big UI changes:
`cd apps/web && set -a && . ./.env && set +a && pnpm build`.

## Server conventions (2026-09)

- **Errors**: modules throw `DomainError` (`modules/errors.ts` helpers `badRequest` / `notFound` / `conflict` / `forbidden` / `preconditionFailed` / `timeout`), never `TRPCError` (Biome blocks `@trpc/server` under `modules/**`); `trpc/init.ts` is the single mapping point and REST/MCP inherit it. Best-effort teardown goes through `bestEffort(label, fn)` (`utils/best-effort.ts`).
- **Service kinds**: never hand-write the seven-way `application | compose | postgres | mysql | mariadb | mongo | redis` union or a `switch` over it — import `SERVICE_KINDS` / `ServiceKind` from `modules/services/kinds` (import-free, bundled by the panel) and dispatch through `SERVICE_REGISTRY[kind]` (`modules/services/registry`); zod inputs use `serviceKindSchema` / `databaseKindSchema`.
- **Transactions**: multi-row writes take `executor: DbExecutor = db` (from `db/index.ts`) and the caller wraps them in `db.transaction(...)`; Swarm, Traefik and file side effects stay outside (best-effort, not rollback-able).
- **Egress**: outbound requests to user-controlled hosts (notification providers, SMTP, git providers, registries, S3, uptime probes, template sources) go through the guards in `utils/public-url.ts` — `assertSafeOutboundUrl` / `assertPublicHttpsUrl` / `assertSafeSmtpHostname` / `assertSafeGitCloneUrl` return a `SafeTarget` (`{ url, addresses, isPrivate }`) and `pinnedFetch(target, init)` dials only those addresses (never global `fetch` on a tenant URL, never connect to `url.hostname` after the check — that reopens DNS rebinding). `allowPrivate: true` at a call site is a request ANDed with the instance toggle `webServer.allowPrivateEgress` (default off); the Swarm overlay `10.0.0.0/8` and platform service names are never reachable.

## Feature recipes

- **New tRPC router**: `packages/server/src/trpc/routers/<kebab>.ts`, export
  `<name>Router`, register in `trpc/root.ts`. Tenant data ⇒
  `protectedProcedure` + `resolveCallerOrganizationId(userId, activeOrgId)`
  (async, falls back to first membership — never read `activeOrganizationId`
  raw). Logic lives in `modules/<domain>/`, routers stay thin. A list/get
  procedure must also declare its project axis in `PROJECT_AXIS`
  (`trpc/tenancy-coverage.ts`) — teams narrow *which projects* a member sees,
  enforced by an AsyncLocalStorage filter the tenancy funnels already read.
- **New page**: under `apps/web/src/app/(dashboard)/dashboard/…`, with
  skeleton + error-with-retry + empty states; add it to the command palette
  (`components/command-palette/command-palette.tsx`) if navigable. Sentence
  case for labels, buttons and dialog titles; errors via `toastError` /
  `describeError`, never `toast.error(error.message)`.
- **New service tab**: service pages share
  `components/services/service-page-header.tsx` and one tab order (General ·
  [Compose file | Connection] · Deploy · Runtime · Domains · Environment ·
  Backups · Advanced · Settings). Tabs sync to `?tab=` via `useSyncedTab`;
  retiring an id means adding it to `SERVICE_TAB_ALIASES` so old deep links
  still land. Register the new tab in the palette's "This Service" group.
- **New long operation**: deployment state comes from the one
  `hooks/use-running-deployments.ts` query — never add another
  `refetchInterval` on deployments. Anything else that runs for minutes
  registers with `components/layout/activity-tray.tsx` via
  `useTrackedActivity` (pending mutation) or `trackActivity` (fire-and-forget).
- **New schema field**: edit `packages/server/src/db/schema/*` →
  `pnpm db:generate` → migration is committed; secrets use `encryptedText`
  (or `encryptedJson` for config blobs). Hand-edit the generated SQL when
  Postgres needs it: `USING` for type casts, backfill before `SET NOT NULL`.
- **New notification channel**: sender in `modules/notifications/providers.ts`,
  value in the `notificationType` pg enum, an `encryptedJson` config column, a
  `dispatchToRow` case, the router's config schema, then the dialog's
  `NOTIFICATION_TYPE_LABELS` / `TYPE_FIELDS` / `buildConfig` / `extractValues`.
- **New template**: append `TemplateData` to
  `packages/server/src/modules/templates/data/<category>.ts` (details in
  `docs/templates.md`); catalog tests validate it automatically.
- **Docker/shell**: `execAsync` local / `execAsyncRemote(serverId)` SSH —
  never `child_process` directly. Paths via `paths.ts` (`NIXPLOY_CONFIG_DIR`).

## Docs map

`AGENTS.md` (conventions), `docs/architecture.md`, `docs/development.md`,
`docs/auth.md`, `docs/deployment-flow.md`, `docs/domains-traefik.md`,
`docs/templates.md`, `docs/install.md`, `docs/getting-started.md`,
`docs/migrate-from-another-panel.md`,
`docs/codebase-map.md` (file-level map), `docs/status.md` (living backlog —
update after each session), `PLAN.md` (product blueprint). Keep them in sync when you
change behavior.
