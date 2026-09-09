# Hardening plan (Phase 9)

No new features. This phase is about making what already exists fast, safe and
maintainable. Every item below was found by measuring the current tree, not by
guessing — the evidence is quoted inline so you can re-check it.

**Baseline at time of writing**

| Metric | Value |
| --- | --- |
| Source files (`packages/server`, `apps/web`, `apps/cli`) | 441 files / 63,708 lines |
| Files over 500 lines | 18 |
| Test files / source files in `packages/server` | 22 / 193 |
| Tests | 492 passing, 1 skipped |
| Postgres tables | 47 |
| Explicit indexes in the Drizzle schema | **3** |
| Drizzle migrations | 10 |

Work is grouped into four tracks. Track 1 is the only one with a real
correctness/performance cliff behind it; the rest are quality-of-life.

---

## Track 1 — Database: indexes and query cost

### 1.1 The schema has almost no indexes ✅

`rg "index\(|uniqueIndex\(" packages/server/src/db/schema/` returns three hits
across 47 tables:

```
audit.ts:30  index("audit_log_org_created_idx")
audit.ts:31  index("audit_log_org_action_idx")
domain.ts:44 uniqueIndex("domain_host_path_unique")
```

Postgres does **not** create an index for a foreign key automatically. Every
other table is scanned sequentially on every tenant-scoped query. It is
invisible on a dev database with 20 rows and becomes the whole latency budget
once a real install accumulates deployments.

Ranking the `eq(...)` filters actually present in the codebase gives the
columns that need covering:

| Column | Where-clause uses | Notes |
| --- | --- | --- |
| `environment.project_id` | 30 | Hottest join in the app |
| `project.organization_id` | 18 | Tenant filter on nearly every list |
| `application.environment_id` | 6 | Project overview fan-out |
| `compose.environment_id` | 6 | Same |
| `deployment.application_id` | 7 | Deployments tab, ordered by `created_at` |
| `deployment.compose_id` | 5 | Same |
| `domain.application_id` / `domain.compose_id` | 9 / 8 | Traefik config regeneration |
| `member.user_id` | 9 | Called on **every** protected procedure (see 1.3) |
| `server.organization_id` | 4 | Servers list |

**Task.** Add indexes to the Drizzle schema, generate one migration, commit it.

- Composite where the query is composite and ordered:
  `index("deployment_app_created_idx").on(deployments.applicationId, deployments.createdAt.desc())`
  and the `compose_id` equivalent. `modules/deployments/index.ts:132` orders by
  `desc(createdAt), desc(deploymentId)` after filtering on the service id, so a
  composite index turns the deployments tab from scan+sort into an index scan.
- Single-column on the remaining FKs listed above.
- `member (user_id, organization_id)` — that exact pair is the lookup in
  `resolveCallerOrganizationId`. The table (`auth.ts:83`) has no constraint on
  it today. It *should* be unique, but better-auth owns the writes, so check
  for existing duplicate rows first and ship a plain `index` if any turn up
  rather than risking a failed migration on someone's live install.
- Partial index on `deployment (is_preview)` is not worth it (low cardinality);
  fold `is_preview` into the composite instead if `EXPLAIN` says so.

**Acceptance.** `pnpm db:generate` produces exactly one migration; seed ~50k
deployment rows locally and confirm `EXPLAIN ANALYZE` on the deployments-tab
query reports an index scan instead of `Seq Scan` + `Sort`.

**Done.** Migration `0010_mature_avengers.sql` adds the hot FK / composite
indexes listed above.

### 1.2 Full-text log search has no GIN index ✅

`observability.ts:81` declares `searchVector: tsvector("search_vector")` and
`modules/observability/index.ts:264` queries it:

```ts
sql`${serviceLogs.searchVector} @@ plainto_tsquery('english', ${q})`
...
.orderBy(desc(sql`ts_rank(${serviceLogs.searchVector}, plainto_tsquery('english', ${q}))`))
```

Without a GIN index this reads every row in `service_log` and recomputes
`ts_rank` for each one. `service_log` is the fastest-growing table in the
product (it stores log chunks, pruned only by total size cap).

**Task.** Add `index("service_log_search_idx").using("gin", serviceLogs.searchVector)`
plus `index("service_log_org_created_idx").on(organizationId, createdAt)` for
the pruning query. Drizzle supports `.using("gin", ...)`; verify the generated
SQL is `USING gin (search_vector)` before committing.

**Acceptance.** `EXPLAIN` on the search query shows `Bitmap Index Scan on
service_log_search_idx`.

**Done.** Schema tracks `service_log_search_vector_idx` (GIN; `IF NOT EXISTS` in
0010 because 0008 already created it) and `service_log_org_created_idx`.

### 1.3 Org resolution runs an uncached query per procedure ✅

`resolveCallerOrganizationId` (`modules/projects/index.ts:31-58`) hits the
`members` table every call. It is called from 35 routers, up to 21 times in
`application.ts` alone. tRPC batches a dashboard page load into a single HTTP
request containing ~10 procedures — that is ~10 identical membership queries
per navigation.

**Task.** Memoize the resolution on the tRPC context. Add a lazily-evaluated
`ctx.organizationId` promise created once per request in `trpc/init.ts`, and
have `getOrganizationId(ctx.session)` return it. Keep the existing exported
function signature so nothing outside tRPC (crons, webhooks, REST) changes.

**Acceptance.** A unit test asserting the underlying `members` query runs once
across multiple procedure calls sharing a context.

**Done.** `getOrganizationId` caches on the session WeakMap;
`protectedProcedure` exposes `ctx.organizationId`; covered by
`modules/application/org.test.ts`.

### 1.4 Connection pool is a fixed `max: 10` ✅

`db/index.ts:21` hardcodes the pool size. A single-node install with the deploy
worker, four crons and the web server sharing one process can saturate that
during a deploy burst, and there is no way to raise it without a rebuild.

**Task.** Read `DATABASE_POOL_MAX` with a default of 10, document it in
`docs/install.md` under env overrides.

**Done.** `db/index.ts` reads `DATABASE_POOL_MAX`; documented in `install.md`.

---

## Track 2 — Structure: naming, duplication, dead code

### 2.1 `modules/deployment/` vs `modules/deployments/` ✅

Two sibling directories one character apart:

- `modules/deployment/` — the deploy engine (worker, queue, builders, swarm,
  reconciler, recovery). 18 files.
- `modules/deployments/` — read-side queries for the deployments list/stats.
  2 files.

This is a genuine footgun; an import off by one letter still resolves.

**Task.** Rename `modules/deployments/` → `modules/deployment-history/` (or
fold it into `modules/deployment/queries.ts`). Prefer the fold: it is 2 files
and the read side belongs with the write side. Update imports, run
`pnpm -F @nixploy/server exec tsc --noEmit`.

**Done.** Folded into `modules/deployment/queries.ts` (+ `queries.test.ts`).

### 2.2 The two deployments tabs are ~50% copy-paste ✅

```
402 apps/web/src/components/application/deployments-tab.tsx
349 apps/web/src/components/compose/deployments-tab.tsx
diff → 331 lines
```

With 751 total lines and a 331-line diff, roughly half of each file is
identical: the log drawer, the Copilot explain dialog, the "Apply env &
redeploy" flow, the status pills, the relative-time formatting. Both grew the
same Copilot changes in Phase 8, applied twice by hand.

**Task.** Extract the shared surface into
`apps/web/src/components/services/deployment-history.tsx` parameterised by
`{ kind: "application" | "compose"; serviceId }`, with the router calls passed
in as props (the two tRPC namespaces differ). Leave the genuinely divergent
parts — preview deployments are application-only — in the callers.

**Acceptance.** Both tabs render identically to today (screenshot light + dark
per the verification loop) and the combined line count drops below 500.

**Done.** Shared `deployment-history.tsx`; thin tabs (~16 lines each); combined
~470 lines. Cancel remains application-only via `canCancel`.

### 2.3 Smaller cleanups ✅ (shim); optional splits deferred

- `components/services/service-status-badge.tsx` is a 3-line re-export shim of
  `status-badge.tsx` with one importer. Inline it and delete the file.
- 18 files exceed 500 lines. The three worst are worth splitting because they
  mix concerns, not merely because they are long:
  - `modules/databases/engine.ts` (766) — five engines in one file; split per
    engine with a shared contract, mirroring how `buildDatabaseRouter` already
    dedupes the routers (those are a good model: 13–16 lines each).
  - `trpc/routers/application.ts` (697) — split the deploy/lifecycle mutations
    out from CRUD.
  - `modules/git/webhook-handler.ts` (682) — split per provider.
- Do **not** split UI files purely on line count. `sidebar.tsx` (694) is
  vendored shadcn and should stay as-is.

**Done.** Deleted unused `service-status-badge.tsx`. Large-file splits left for
a later pass (optional in Sprint D).

---

## Track 3 — Testing and CI gaps

### 3.1 Zero tests cover tenant isolation ✅

22 test files cover builders, Traefik YAML, the template catalog, encryption
and db utils. None covers a tRPC router. The single highest-severity bug class
in a multi-tenant PaaS — one org reading another org's rows — has no automated
guard, and every one of the ~250 procedures reimplements the filter by hand.

**Task.** Add `packages/server/src/trpc/tenancy.test.ts` against a throwaway
Postgres (testcontainers or a `DATABASE_URL_TEST` schema): seed two orgs with
one project each, then for every list/get procedure assert org A's caller sees
only org A's rows and gets `NOT_FOUND`/`FORBIDDEN` for org B's ids. Drive it
from the router map so newly added procedures fail the test until listed.

This is the single most valuable item in the document.

**Done.** `DATABASE_URL_TEST` + seed harness; isolation assertions for project /
application / compose / server / destination / registry / sshKey / certificate /
notification / postgres; coverage registry fails CI if a new `*.all|one|list`
is neither COVERED nor EXEMPT. CI migrates a Postgres service before `pnpm test`.

### 3.2 `apps/landing` is not typechecked ✅

`pnpm typecheck` runs `pnpm -r typecheck`, and `apps/landing/package.json` has
no `typecheck` script — only `dev`, `build`, `start`. CI therefore never
typechecks the marketing site. It happens to pass today (`npx tsc --noEmit`
exits 0), so this is cheap to close before it breaks.

**Task.** Add `"typecheck": "tsc --noEmit"` to `apps/landing/package.json`.

**Done.** Landing `typecheck` script added.

### 3.3 Logging is ad-hoc ✅

37 `console.log/error/warn` calls across `packages/server`, concentrated in the
crons (`updates/scheduler.ts` 6, `backups/scheduler.ts` 5, `schedules/index.ts`
4, `deployment/maintenance.ts` 4). For a product operators run on their own
box, unstructured logs with no level control mean "check the container logs and
squint".

**Task.** Add a minimal `lib/logger.ts` (no dependency — the workspace
dependency set is fixed): level from `LOG_LEVEL`, prefix with the subsystem,
JSON output when `LOG_FORMAT=json`. Replace the 37 call sites mechanically.
Document `LOG_LEVEL` in `docs/install.md`.

**Done.** `lib/logger.ts` + cron subsystems migrated (updates, backups,
schedules, maintenance, reconciler, metrics-history). Remaining ad-hoc
`console.*` in rare paths can migrate opportunistically.

---

## Track 4 — Runtime cost of things Phase 8 added

### 4.1 The servers table fires one SSH round-trip per row ✅

`ServerCapacityCell` calls `trpc.server.getStats` per row, and
`getServerStats` (`modules/cluster/servers.ts:263`) opens an SSH session that
runs six commands (`docker info`, `df`, `free`, `/proc/loadavg`, `nproc`).
Rendering the servers list with N servers opens N SSH connections at once, and
`staleTime: 30_000` only helps within a session — a hard refresh re-fans-out.
This regresses the servers page the moment someone has more than a couple of
nodes, which is exactly the multi-server audience the feature targets.

**Task.** Replace the per-row query with one `server.getStatsBatch` procedure
that resolves all servers concurrently server-side with a bounded pool
(4 at a time) and a short in-process TTL cache (~30s) shared across callers, so
two users viewing the page do not double the SSH load. Keep the per-row
component but feed it from the batched result.

**Acceptance.** Servers page with 5 configured servers issues one tRPC call and
at most 4 concurrent SSH sessions.

**Done.** `getServerStatsBatch` + `getServerStatsCached`; table uses
`getStatsBatch`; single-server `getStats` / monitoring share the cache.

### 4.2 `redeployChangedFromApply` queries in a loop ✅

`modules/gitops/redeploy.ts:32-35` loops over plan items and awaits a
`db.query.applications.findFirst` per item. Plans are small today so this is
not urgent, but it is the classic N+1 and cheap to fix.

**Task.** Collect the ids first, fetch with a single `inArray` query, then loop
over the in-memory map.

**Done.** Batch `findMany` + `inArray` for applications and compose by name.

### 4.3 Audit the polling intervals ✅

Eleven components use `refetchInterval`. `monitoring-charts.tsx:388` polls
every 5s and two more poll every 60s on the same screen; `containers-tab.tsx`
and `host-monitoring-card.tsx` poll every 10s. Several of these hit Docker or
SSH on the server side.

**Task.** Inventory each interval against what it actually costs server-side,
and gate polling on document visibility (`refetchIntervalInBackground: false`
is already the default, but a background tab still polls when focused-then-
hidden semantics differ). Move anything backed by an SSH call to 30s minimum.

**Done.** Docker/SSH-backed polls raised to 30s (containers, host monitoring,
replica stats, database status). TanStack Query v5 already defaults
`refetchIntervalInBackground: false`.

---

## Suggested order

1. **1.1 + 1.2 + 1.3** — one migration and one context change; biggest measurable win.
2. **3.1** — tenancy test suite; biggest risk reduction.
3. **4.1** — undo the servers-page regression before anyone hits it.
4. **2.1 + 2.2 + 2.3** — structural cleanup, safest to do once tests exist.
5. **3.2 + 3.3 + 1.4 + 4.2 + 4.3** — small, independent, batchable.

Each item should land as its own commit, with the standard loop after every
change: `pnpm -F @nixploy/server exec tsc --noEmit`, `cd apps/web && pnpm exec
tsc --noEmit`, `pnpm test`, `pnpm exec biome check --write <files>`.
