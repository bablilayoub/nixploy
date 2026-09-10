## What

<!-- One paragraph: what changes and why. Link the issue if there is one. -->

## How to verify

<!-- Commands, screens (light + dark for UI), smoke steps. -->

## Checklist

- [ ] `pnpm typecheck` (or the per-workspace `tsc --noEmit`) passes
- [ ] `pnpm exec biome check packages/server apps/web apps/cli apps/landing` passes
- [ ] `pnpm test` passes (with `DATABASE_URL_TEST` set when touching routers or tenancy)
- [ ] Docs updated in `docs/` (and `apps/landing/src/lib/docs/pages.ts` when operator-facing)
- [ ] `docs/status.md` updated (snapshot, backlog, known debt) when behaviour or dependencies changed
- [ ] Schema change → migration generated with `pnpm db:generate` and committed
- [ ] No new dependencies, or the reason is in the description
