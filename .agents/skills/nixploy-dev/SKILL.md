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

## Feature recipes

- **New tRPC router**: `packages/server/src/trpc/routers/<kebab>.ts`, export
  `<name>Router`, register in `trpc/root.ts`. Tenant data ⇒
  `protectedProcedure` + `resolveCallerOrganizationId(userId, activeOrgId)`
  (async, falls back to first membership — never read `activeOrganizationId`
  raw). Logic lives in `modules/<domain>/`, routers stay thin.
- **New page**: under `apps/web/src/app/(dashboard)/dashboard/…`, with
  skeleton + error-with-retry + empty states; add it to the command palette
  (`components/command-palette/command-palette.tsx`) if navigable.
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
`docs/migrate-from-dokploy.md`, `docs/migrate-from-coolify.md`,
`docs/codebase-map.md` (file-level map), `docs/status.md` (living backlog —
update after each session), `PLAN.md` (product blueprint). Keep them in sync when you
change behavior.
