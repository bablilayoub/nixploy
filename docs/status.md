# Repo status & working backlog

Living document. Every work session (human or AI) should refresh the snapshot
and move items between the backlog sections. Durable knowledge belongs in
[`../CLAUDE.md`](../CLAUDE.md) / [`codebase-map.md`](./codebase-map.md); this
file is for **state** and **tasks**.

## Snapshot — 2026-09-10 (end of sprint 1)

| Item | Value |
| --- | --- |
| Branch | `chore/sprint-1-hygiene` — 12 commits on top of `main` @ `07ab3d4`, **not pushed, not merged** (user decision) |
| Tags / releases | PaaS `v0.1.0` (GitHub Release + GHCR), CLI `cli-v0.1.1` (npm `@nixploy/cli@0.1.1`) — unchanged |
| Local toolchain | Node 22.21.0, pnpm 10.33.0, Docker 29.7.2, Swarm active |
| Key versions now | Next 16.3.4 (web **and** landing), better-auth + api-key 1.7.3, React 19.2.8, Biome 2.5.12, zod 4.6.1, TanStack Query 5.102, lucide 1.43 (both apps), TypeScript 5.9.3, vitest 4.1.10, drizzle-orm 0.45.2 |
| `pnpm typecheck` | ✅ all 4 workspaces |
| `pnpm test` | ✅ 44 files, 714 passed offline / 726 passed with `DATABASE_URL_TEST` (1 skipped) |
| Biome (CI command) | ✅ 0 errors, 0 warnings |
| `pnpm build` (web + landing + cli) | ✅ including a web build without `DATABASE_URL` (Docker scenario) |
| Runtime checks done | Panel on a throwaway DB: setup wizard, 2FA enroll/verify, sign-out, sign-in via `/two-factor`, API key, REST, MCP, invite hooks, proxy redirect matrix. Landing: `next start` 200 on every route. |
| Dev DB | Container `nixploy-dev-pg` running (`127.0.0.1:54329`); databases `nixploy` (dev) and `nixploy_test` (migrated, for the tenancy suite) |
| Local swarm | `nixploy-traefik` global service running; leftover smoke service `hello-ac7e44` (redis) still running |
| Code size | server 219 source files / 44 test files; 27 files > 500 lines (largest: `git/webhook-handler.ts` 864, `databases/engine.ts` 773, `routers/application.ts` 770) |
| Schema | 18 migrations (`0000`…`0017`), no new migration needed for better-auth 1.7.3 (plugin schemas identical) |
| Product | Phases 1–10 of `PLAN.md` shipped; 42 routers / ~300 procedures; 86 templates in 15 categories; 11 notification providers; MCP with 13 tools |

## Dependency upgrade candidates (remaining)

Everything patch/minor and the better-auth / Next majors are done (see session log). What is left are real majors; each wants its own branch and a go/no-go note here.

| Package | Current → Latest | Risk | Notes |
| --- | --- | --- | --- |
| `typescript` | 5.9.3 → 7.0.2 | **High** | TS 7 (Go-based compiler). Biome, drizzle-kit, tsup, Next's TS plugin must all cope. Nothing needs it today. |
| `vitest` | 4.1.10 → 5.0.0 | Medium | Check `vitest.config.ts` `env` option + `include` semantics; better-auth peer allows `^4` only — a `^5` peer warning is expected. |
| `commander` (cli) | 13.1.0 → 15.0.0 | Low-Med | Option parsing defaults changed across 14/15; run every CLI command against a panel. |
| `nodemailer` | 9.0.3 → 10.0.2 | Low-Med | Email notification provider only. |
| `@tanstack/react-table` | 8.21.3 → 9.2.4 | Medium | Only `components/data-table/*` + services table; v9 API changes. |
| `motion` (landing) | 12.43 → 13.2 | Low | magicui components only. |
| `node-os-utils` | 2.0.4 → 3.1.0 | Low | Host monitoring; Alpine disk calls already dropped (commit `2073947`). |
| `react` / `react-dom` (+ `@types/react*`) | 19.2.8 → 19.3.0 | Low-Med | Minor, but bump together with a Next release that lists 19.3 as tested. |
| `drizzle-orm` | 0.45.2 → 1.0.0-rc | Deferred | better-auth 1.7 peer accepts `>=1.0.0-rc.1`; wait for the drizzle 1.0 stable + drizzle-kit pairing. |

Image pins to review periodically: `traefik:v3.5.0` (install.sh, update.sh, setup.ts, ci.yml), `postgres:17-alpine`, `node:22-alpine`, `traefik/whoami:v1.10.1`, template images (CI probes that tags exist, not that they are current).

## Known debt / gotchas (verified in code)

- [x] ~~Four `getConfigDir` implementations~~ — unified in `modules/deployment/paths.ts` (`NIXPLOY_DIR` kept as legacy alias); overlay network name unified in `modules/application/paths.ts#getSwarmNetwork` (databases + remote-server setup previously ignored `NIXPLOY_NETWORK`).
- [x] ~~`apps/web/pnpm-lock.yaml` stale tracked file~~ — deleted.
- [x] ~~`better-auth` version range mismatch~~ — both pinned, now `1.7.3`.
- [x] ~~Biome warnings~~ — clean; `noDescendingSpecificity` is off for `swagger-theme.css` only (biome.json override).
- [x] ~~`apps/web/middleware.ts` → `proxy.ts`~~ — now `apps/web/src/proxy.ts`. A root-level file is **not discovered** when the app dir is `src/app` (Next scans only the app dir's parent). Open question: whether the root-level `middleware.ts` shipped in v0.1.0 was ever active; the dashboard layout's `getSession` check was always the authoritative gate, so no exposure either way.
- [x] ~~Landing on Next 15~~ — both apps on 16.3.4.
- [x] ~~`hardening.md` / `next.md` historical checklists~~ — moved to `docs/archive/`, links updated.
- [ ] `NEXT_PUBLIC_APP_URL` is still read as a third fallback by the GitHub App callback (`api/github/callback/route.ts`). Drop the fallback once `BETTER_AUTH_URL` is guaranteed everywhere (install.sh always writes it).
- [ ] better-auth logs `ERROR [Better Auth]: Failed to validate API key` for every bad `x-api-key` (noisy on a public panel; harmless). Consider lowering via better-auth `logger` config.
- [ ] Landing docs (`apps/landing/src/lib/docs/pages.ts`) hand-duplicate `docs/*` — drift risk, no check.
- [ ] `next.config.ts` sets `output: "standalone"` but the image runs `tsx server.ts` from the full tree; standalone output is built and unused (image size).
- [ ] `playwright-core` lives only in `tools/screenshots` (separate npm project with `package-lock.json`); `apps/web/e2e/smoke.mjs` and `docs/development.md` assume it is available — decide: add as root devDependency or point docs at `tools/screenshots`.
- [ ] `dev.sh` is gitignored (local helper) although `CONTRIBUTING.md`/`AGENTS.md` do not mention it; either track it or keep it personal.
- [ ] Large files flagged in `archive/hardening.md §2.3` still unsplit: `databases/engine.ts`, `routers/application.ts`, `git/webhook-handler.ts`.
- [ ] Remaining `console.*` in non-cron paths (e.g. `projects/index.ts` cascade teardown, worker observability catch) could move to `lib/logger.ts`.
- [ ] `deploymentStatus` enum lacks `queued`; queued rows show as `running` (documented, UI copes). Consider adding the enum value with a migration if the UI should distinguish.
- [ ] `install.sh` / `update.sh` default `NIXPLOY_VERSION=v0.1.0`; `tools/release.sh` re-pins on release. Any manual edit must keep the exact line format the release workflow greps for.
- [ ] Local swarm leftover service `hello-ac7e44` and stale `.nixploy-data/metrics/*.jsonl` from earlier smoke tests (harmless, local only).
- [ ] Next 16.3 deprecates the Edge runtime and "undocumented custom server methods"; `apps/web/server.ts` only uses `next()`, `prepare()`, `getRequestHandler()` (documented) — keep it that way.

## Next steps

1. **Merge decision** — review `chore/sprint-1-hygiene` (12 commits, each independently revertible), merge to `main`, let CI + the Docker workflow run. A PaaS release (`v0.1.1`) would ship better-auth 1.7.3 + Next 16.3 to installs via `update.sh`.
2. **Major evaluations** (one branch each, go/no-go here): commander 15 (CLI), vitest 5, react-table 9, TypeScript 7, nodemailer 10, motion 13.
3. **Debt** from the list above, smallest first: API-key error log noise, `NEXT_PUBLIC_APP_URL` fallback, playwright-core location, landing docs drift check.
4. **Structure**: split the three >750-line server files (see `archive/hardening.md §2.3`) once tests exist for the paths touched.

## Session log

- **2026-09-10 (audit)** — Initial audit. Added `CLAUDE.md`, `docs/codebase-map.md`, this file. Verified typecheck/test/biome locally; no code changes.
- **2026-09-10 (sprint 1, branch `chore/sprint-1-hygiene`)** — 12 commits: drop stale web lockfile; unify `getConfigDir`; pin better-auth; unify overlay-network name; silence Biome warnings; docs + archive move; routine in-range bumps (Biome 2.5.12, zod 4.6, TanStack Query 5.102, RHF 7.87, lucide 1.43, aws-sdk, octokit, …); **better-auth 1.7.3** (2FA response narrowing + db proxy `_` probe; full manual auth loop verified on a throwaway DB); **Next 16.3.4 + `src/proxy.ts`** (root placement is ignored — verified); **landing → Next 16.3.4 + lucide 1.x**. All gates green: typecheck, full vitest with `DATABASE_URL_TEST`, Biome, workspace build, runtime smokes. Nothing pushed.
