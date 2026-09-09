# Repo status & working backlog

Living document. Every work session (human or AI) should refresh the snapshot
and move items between the backlog sections. Durable knowledge belongs in
[`../CLAUDE.md`](../CLAUDE.md) / [`codebase-map.md`](./codebase-map.md); this
file is for **state** and **tasks**.

## Snapshot — 2026-09-10

| Item | Value |
| --- | --- |
| Branch / commit | `main` @ `07ab3d4` (clean tree), 44 commits since 2026-08-05 |
| Tags / releases | PaaS `v0.1.0` (GitHub Release + GHCR), CLI `cli-v0.1.1` (npm `@nixploy/cli@0.1.1`) |
| Local toolchain | Node 22.21.0, pnpm 10.33.0, Docker 29.7.2, Swarm active |
| `pnpm typecheck` | ✅ all 4 workspaces |
| `pnpm test` | ✅ 44 files, 714 passed, 13 skipped (tenancy suite needs `DATABASE_URL_TEST`) |
| Biome (CI command) | ✅ 0 errors, 3 warnings (`swagger-theme.css` specificity ×2, `sidebar.tsx` `document.cookie`) |
| GitHub Actions | CI, Docker green on latest main (2026-08-10). Two earlier CI failures on `[skip ci]`-less chore commits were fixed by `2d9e98d`. |
| Dev DB | Container `nixploy-dev-pg` exists but **exited 4 weeks ago** — `docker start nixploy-dev-pg` before running the panel or the tenancy tests |
| Local swarm | `nixploy-traefik` global service running; leftover test service `hello-ac7e44` (redis) still running |
| Code size | server 219 source files / 44 test files; 27 files > 500 lines (largest: `git/webhook-handler.ts` 864, `databases/engine.ts` 773, `routers/application.ts` 770) |
| Schema | 18 migrations (`0000`…`0017`), indexes on hot FKs since `0010`, GIN on `service_log.search_vector` |
| Product | Phases 1–10 of `PLAN.md` shipped; 42 routers / ~300 procedures; 86 templates in 15 categories; 11 notification providers; MCP with 13 tools |

## Dependency upgrade candidates (from `pnpm outdated -r`)

Ordered by risk. The workspace pins are deliberate (`pnpm.overrides` in root `package.json` also force patched `tar`, `postcss`, `esbuild`, `sharp`, `js-yaml`, `hono`, …). Upgrade one row per commit with the full verification loop.

| Package | Current → Latest | Risk | Notes |
| --- | --- | --- | --- |
| `better-auth`, `@better-auth/api-key` | 1.6.25 → 1.7.3 | **High** | Pinned in web, ranged `^1.3.4` in server (unify). Check org/admin/twoFactor/apiKey plugin schema diffs, `verifyApiKey` return shape (`referenceId`), `databaseHooks` signatures, rate-limit config. Re-run tenancy suite + manual login/2FA/API-key flows. |
| `next` (landing) | 15.5.22 → 16.3.4 | Medium | Separate app; Next 16 = Turbopack default, async request APIs, `proxy.ts`. Lucide 0.544 → 1.x rename check. |
| `typescript` | 5.9.3 → 7.0.2 | **High** | TS 7 (Go-based compiler). Biome, drizzle-kit, tsup, Next plugin compatibility must all be verified. Try in a branch; not required for anything today. |
| `vitest` | 4.1.10 → 5.0.0 | Medium | Check `vitest.config.ts` `env` option + `include` semantics. |
| `commander` (cli) | 13.1.0 → 15.0.0 | Low-Med | Breaking: option parsing defaults; run every CLI command against a panel. |
| `nodemailer` | 9.0.3 → 10.0.2 | Low-Med | Email notification provider only. |
| `@tanstack/react-table` | 8.21.3 → 9.2.4 | Medium | Only `components/data-table/*` + services table; v9 API changes. |
| `motion` (landing) | 12.43 → 13.2 | Low | magicui components. |
| `node-os-utils` | 2.0.4 → 3.1.0 | Low | Host monitoring; Alpine disk calls already dropped (commit `2073947`). |
| `zod` | 4.4.3 → 4.6.1 | Low | Minor; drizzle-zod compat. |
| `lucide-react` (web) | 1.27 → 1.43 | Low | Icon renames possible. |
| `@aws-sdk/client-s3`, `@octokit/*`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `shadcn`, `input-otp`, `react`/`react-dom` 19.2 → 19.3, `@types/*`, `@biomejs/biome` 2.5.5 → 2.5.12, `tsx`, `ws`, `swagger-ui-dist`, `sonner`, `@codemirror/*`, `postcss` | patch/minor | Low | Batch as "chore: routine bumps" after the high-risk rows. Biome bump may add new lint rules. |

Image pins to review periodically: `traefik:v3.5.0` (install.sh, update.sh, setup.ts, ci.yml), `postgres:17-alpine`, `node:22-alpine`, `traefik/whoami:v1.10.1`, template images (CI probes tags exist, not that they are current).

## Known debt / gotchas (verified in code)

- [x] ~~Four `getConfigDir` implementations~~ — unified in `modules/deployment/paths.ts` (`NIXPLOY_DIR` kept as legacy alias); overlay network name unified in `modules/application/paths.ts#getSwarmNetwork` (databases + remote-server setup previously ignored `NIXPLOY_NETWORK`).
- [x] ~~`apps/web/pnpm-lock.yaml` stale tracked file~~ — deleted.
- [ ] `NEXT_PUBLIC_APP_URL` is still read as a third fallback by the GitHub App callback (`api/github/callback/route.ts`). Drop the fallback once `BETTER_AUTH_URL` is guaranteed everywhere (install.sh always writes it).
- [x] ~~`better-auth` version range mismatch~~ — both pinned `1.6.25`.
- [x] ~~Biome warnings~~ — suppressed with reasoned `biome-ignore` comments; `biome check` is clean.
- [x] ~~`apps/web/middleware.ts` → `proxy.ts`~~ — migrated to `apps/web/src/proxy.ts` with the Next 16.3 bump. Finding: a root-level `apps/web/proxy.ts` is not discovered when the app dir is `src/app` (build shows no `ƒ Proxy`, deep `/dashboard/*` paths fell through to the layout redirect, `/register/x` 404'd). Open question: whether the root-level `middleware.ts` shipped in v0.1.0 was ever active either — the dashboard layout's `getSession` check was always the authoritative gate, so no exposure, but worth a quick check on a v0.1.0 image before assuming the proxy ever ran there.
- [ ] Landing on Next 15 while panel on Next 16; landing docs (`src/lib/docs/pages.ts`) hand-duplicate `docs/*` — drift risk, no check.
- [ ] `next.config.ts` sets `output: "standalone"` but the image runs `tsx server.ts` from the full tree; standalone output is built and unused (image size).
- [ ] `playwright-core` lives only in `tools/screenshots` (separate npm project with `package-lock.json`); `apps/web/e2e/smoke.mjs` and `docs/development.md` assume it is available — decide: add as root devDependency or point docs at `tools/screenshots`.
- [ ] `dev.sh` is gitignored (local helper) although `CONTRIBUTING.md`/`AGENTS.md` do not mention it; either track it or keep it personal.
- [ ] Large files flagged in `archive/hardening.md §2.3` still unsplit: `databases/engine.ts`, `routers/application.ts`, `git/webhook-handler.ts`.
- [ ] Remaining `console.*` in non-cron paths (e.g. `projects/index.ts` cascade teardown, worker observability catch) could move to `lib/logger.ts`.
- [ ] `deploymentStatus` enum lacks `queued`; queued rows show as `running` (documented, UI copes). Consider adding the enum value with a migration if the UI should distinguish.
- [ ] `install.sh` / `update.sh` default `NIXPLOY_VERSION=v0.1.0`; `tools/release.sh` re-pins on release. Any manual edit must keep the exact line format the release workflow greps for.
- [x] ~~`hardening.md` / `next.md` historical checklists~~ — moved to `docs/archive/`, links updated.
- [ ] Local swarm leftover service `hello-ac7e44` and stale `.nixploy-data/metrics/*.jsonl` from earlier smoke tests (harmless, local only).

## Upcoming work (user intent: fixing, upgrading, migrating)

Fill in as scoped. Suggested first sprint:

1. **Hygiene** — delete stale web lockfile, unify `getConfigDir`, fix/suppress Biome warnings, align better-auth ranges, docs archive move. Low risk, one commit each.
2. **Routine dependency bumps** — patch/minor rows above in one commit; run the full loop with `DATABASE_URL_TEST`.
3. **better-auth 1.7** — branch, read changelog 1.6 → 1.7, diff generated schema (`npx @better-auth/cli generate` equivalent against Drizzle), add migration if columns changed, manual auth flows.
4. **Next 16.3 + `proxy.ts`** (panel), then **landing → Next 16**.
5. **Bigger evaluations** — TypeScript 7, vitest 5, react-table 9, commander 15: each in its own branch with a go/no-go note here.

## Session log

- **2026-09-10** — Initial audit. Added `CLAUDE.md`, `docs/codebase-map.md`, this file. Verified typecheck/test/biome locally; no code changes.
