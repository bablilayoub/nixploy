# What we do next (no new features)

**Rule for this phase:** organize, harden, optimize, and polish what already
ships. Do **not** add product surface (no new routers, templates categories,
notification channels, billing, SSO, etc.) unless fixing a correctness bug.

This is the working checklist. Deep technical evidence and acceptance criteria
for DB / structure / tenancy / runtime live in
[`hardening.md`](./hardening.md) — do not duplicate those specs here; execute
them in the order below.

---

## North star

When this phase is done, a real multi-tenant install should feel:

1. **Fast enough** — list pages and deployments tab use indexes; org lookup is
   once per request; servers page does not open N SSH sessions.
2. **Safe enough** — automated tenancy tests catch cross-org leaks.
3. **Navigable** — docs have one index; code names don’t collide; shared UI
   isn’t copy-pasted twice.
4. **Operable** — logs have levels; landing is typechecked; install/update docs
   don’t drift.

---

## Sprint order (do in this sequence)

| Sprint | Focus | Source of truth | Done when |
| --- | --- | --- | --- |
| **A** ✅ | Database indexes + org ctx cache + pool env | hardening §1.1–1.4 | One migration; EXPLAIN shows index scans; membership query once/request |
| **B** ✅ | Tenancy test suite | hardening §3.1 | `tenancy.test.ts` fails if a list/get leaks across orgs |
| **C** ✅ | Servers batch stats | hardening §4.1 | One tRPC call for the servers table; ≤4 concurrent SSH |
| **D** ✅ | Structure cleanup | hardening §2.1–2.3 | `deployments/` renamed/folded; shared deployment history component; dead shim gone |
| **E** ✅ | DX / logging / polling / small N+1 | hardening §3.2–3.3, §1.4, §4.2–4.3 | Landing typecheck; `lib/logger`; quieter polls; gitops `inArray` |
| **F** ✅ | Docs + UX consistency | this file §F | `docs/README.md` complete; settings/empty-state pass; FAQ a11y |

Each sprint = one or more focused PRs. After every change run:

```bash
pnpm -F @nixploy/server exec tsc --noEmit
cd apps/web && pnpm exec tsc --noEmit
pnpm test
pnpm exec biome check --write <changed files>
```

---

## Sprint A — Database & request cost ✅

See [`hardening.md` Track 1](./hardening.md#track-1--database-indexes-and-query-cost).

Checklist:

- [x] Indexes on hot FKs (`environment.project_id`, `project.organization_id`,
  `deployment.(application_id|compose_id, created_at)`, `member.user_id`, …)
- [x] GIN on `service_log.search_vector` + org/created prune index
- [x] Memoize `organizationId` on tRPC context (one membership lookup per HTTP request)
- [x] `DATABASE_POOL_MAX` env (default 10), documented in `install.md`

**Why first:** every other optimization is noise if Postgres is scanning 47
tables without indexes once real data accumulates.

**Shipped:** migration `0010_mature_avengers.sql`; `getOrganizationId` WeakMap
cache + `ctx.organizationId` on `protectedProcedure`; unit test in
`modules/application/org.test.ts`.

---

## Sprint B — Tenancy tests ✅

See [`hardening.md` §3.1](./hardening.md#31-zero-tests-cover-tenant-isolation).

Checklist:

- [x] Throwaway Postgres for tests (testcontainers or `DATABASE_URL_TEST`)
- [x] Seed two orgs; assert list/get procedures never return the other org’s rows
- [x] Prefer driving coverage from the router map so new procedures fail CI
  until listed

**Why second:** highest-severity bug class in a PaaS; safest time to refactor
structure (Sprint D) is after these tests exist.

**Shipped:** `trpc/tenancy.test.ts` + harness + `tenancy-coverage.ts` registry;
CI `check` job runs Postgres + migrate + `DATABASE_URL_TEST`. Isolation cases
skip locally when the env is unset.

---

## Sprint C — Undo Phase 8 servers-page cost ✅

See [`hardening.md` §4.1](./hardening.md#41-the-servers-table-fires-one-ssh-round-trip-per-row).

Checklist:

- [x] `server.getStatsBatch` (or equivalent) with concurrency cap + short TTL cache
- [x] `ServerCapacityCell` / table consume the batch, not N× `getStats`
- [x] Manual check: 5 servers → 1 client query, ≤4 parallel SSH

**Shipped:** `getServerStatsBatch` / `getServerStatsCached` (4-wide pool, 30s
TTL); `server.getStatsBatch`; servers table feeds capacity cells from one query.

---

## Sprint D — Organize the codebase ✅

See [`hardening.md` Track 2](./hardening.md#track-2--structure-naming-duplication-dead-code).

Checklist:

- [x] Fold or rename `modules/deployments/` → avoid clash with `modules/deployment/`
- [x] Extract shared deployments UI
  (`components/services/deployment-history.tsx` or similar)
- [x] Delete `service-status-badge.tsx` re-export shim
- [x] Optional splits only where concerns mix: `databases/engine.ts`,
  `application` router lifecycle vs CRUD, `git/webhook-handler.ts` by provider  
  **Do not** split vendored `sidebar.tsx` for line count — deferred (not required)

**Shipped:** `modules/deployment/queries.ts` (+ test); shared
`deployment-history.tsx` (~470 lines total vs ~751); deleted
`service-status-badge.tsx` (zero importers).

---

## Sprint E — DX, logs, polling ✅

See [`hardening.md` Track 3–4](./hardening.md#track-3--testing-and-ci-gaps) remaining items.

Checklist:

- [x] `apps/landing` `"typecheck": "tsc --noEmit"` so root `pnpm typecheck` covers it
- [x] Minimal `lib/logger.ts` (`LOG_LEVEL`, optional JSON); replace ad-hoc `console.*` in crons
- [x] Document `LOG_LEVEL` / `DATABASE_POOL_MAX` in `install.md`
- [x] GitOps redeploy: single `inArray` fetch, not per-item `findFirst`
- [x] Audit `refetchInterval` users; SSH/Docker-backed polls ≥30s; respect visibility
- [x] Fix or remove dead `apps/web` `"lint": "next lint"` (Biome is source of truth)

**Shipped:** landing typecheck; `createLogger`; cron subsystems on logger;
gitops batch lookup; Docker/SSH polls at 30s; removed dead `next lint` script.

---

## Sprint F — Docs & UX polish (no new product) ✅

### F.1 Documentation organization

- [x] Growth guides: install, getting-started, migrate-from-* (done)
- [x] Hardening plan: `hardening.md` (done)
- [x] **`docs/README.md` index** — every guide in one table (audience + purpose)
- [x] Link this file + hardening from `PLAN.md` as Phase 9
- [x] Landing `/docs` “More” list: architecture, domains, migrate guides
- [x] README “Docs” section: point at `docs/README.md`
- [x] Align install env tables: `README.md` ↔ `docs/install.md` ↔ landing
  `/install` (single source of truth = `install.md`, others link)
- [x] Document `update.sh` knobs (`NIXPLOY_UPDATE_TRAEFIK`, prune, …) in `install.md`

### F.2 UI consistency (existing screens only)

- [x] Prefer shared `QueryState` / empty / error+retry on list pages that still
  hand-roll skeletons (`activity-view`, git-provider panels, …)
- [x] Settings nav: light grouping only (Identity / Infra / Integrations) —
  no new settings pages
- [x] Landing FAQ accordion: `aria-expanded` / `aria-controls`
- [ ] Screenshot pass (light + dark) on surfaces touched in Sprints C–D —
  deferred to manual/Playwright smoke when convenient

### F.3 Bundle weight (optional, after A–E)

- [ ] `next/dynamic` for CodeMirror, Recharts, xterm entry points so first paint
  of unrelated tabs stays light — measure before/after with Next bundle analyzer
  if available; skip if no clear win — **deferred (optional)**

---

## Explicitly out of scope (still deferred)

Do **not** pull these into this phase:

- Stripe / billing, SSO/SCIM, granular permission matrix
- AI compose generation, dedicated build-server role
- New CLI compose/template commands, tags UI
- New notification providers, new template categories
- Kubernetes, Redis queue, rewriting Traefik to another proxy

If a bug report needs a tiny feature to fix correctness, file it separately and
keep the PR surgical.

---

## How to pick work on a given day

1. Open this file → next unchecked Sprint A→F item.
2. Read the matching `hardening.md` section for acceptance criteria.
3. Implement → validation loop → one focused commit.
4. When a sprint’s checklist is empty, mark it done here and in `PLAN.md`.

When all sprints are checked, Phase 9 (polish) is complete — then revisit
product bets (growth, permissions, etc.) with a clean base.
