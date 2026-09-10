# Improvement audit — 2026-09-11

Six parallel read-only audits of `work/stability-and-landing` @ `5771d7b`, run after the stability
sweep (`docs/status.md`, "What the stability sweep did"). The sweep fixed bugs; this audit answers
**"what should we improve next?"**. Every finding in the per-scope reports carries `file:line`
evidence; nothing here was fixed yet.

| Report | Focus | Findings |
| --- | --- | --- |
| [security.md](./security.md) | Posture beyond the sweep: blast radius, isolation, egress, supply chain, audit | 4 high, 14 med, ~20 low/hardening |
| [architecture.md](./architecture.md) | Queue, crons, metrics, logs, DB, Docker/SSH transport, process model, upgrades | 5 high, 9 med, 6 low |
| [product-gaps.md](./product-gaps.md) | Feature gaps vs Dokploy / Coolify / Railway; half-built features | 38 gaps (16 P1), 20 half-built |
| [ops-dx.md](./ops-dx.md) | Install/update, DR, platform observability, CI/CD, tests, docs, CLI | 5 high, 21 med, 5 low |
| [code-health.md](./code-health.md) | Structure, duplication, error handling, transactions, contracts, dead code | 4 high, 6 med, 4 low |
| [ux.md](./ux.md) | Panel onboarding, IA, forms, feedback, a11y, responsiveness (drove the real app, 98 screenshots) | 4 high, 17 med, 14 low |

Baseline that frames everything: one root Node process with the Docker socket runs UI + API + WS +
in-memory queue + crons; Postgres and the panel share the tenant overlay; API keys are unscoped;
no health endpoint, no graceful shutdown, no transactions, no security headers.

## 1. Do first (one to two weeks, all small)

Ordered by blast radius × ease. Each is S effort unless marked.

| # | Change | Why | Source |
| --- | --- | --- | --- |
| 1 | Gate `compose.update` on `hostPrivileged` (assert instance admin, reset the flag on any source change) | A `member` can repoint an admin-deployed Portainer/Dozzle stack at their repo → docker.sock → host root | security 2.5 |
| 2 | Require instance admin for Swarm joins (at least `swarmRole: "manager"`), default worker, audit `server.setup` | Org admin joins their own host as a manager and reads/mutates every tenant's service spec | security 2.3 |
| 3 | Stop shipping `/etc/nixploy/.env` inside instance backups (exclude + document, or encrypt the archive) | The bucket holds every ciphertext and the `ENCRYPTION_KEY` next to it | security 2.11, ops #5 |
| 4 | Size caps: Traefik `buffering` on the dashboard router, zod `.max()` on compose/env/mount strings, WS `maxPayload`, `watchPaths` caps + memoised globs | Cheapest DoS: unauthenticated multi-GB POST or a ReDoS glob pins the single event loop | security 2.1, 2.7 |
| 5 | Security headers (`headers()` in `next.config.ts`: `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy) + HSTS middleware on the dashboard router | None exist today | security 2.1 |
| 6 | Graceful shutdown: SIGTERM handler (close HTTP, WS, crons, cancel/mark running jobs), `unhandledRejection` guard, `--stop-grace-period 90s`, refuse in-app update while a deploy runs | Every `update.sh` hard-kills in-flight builds; one stray rejection takes down UI+API+queue+crons | architecture #4, ops #2 |
| 7 | Local build timeout + per-job deadline (reuse `remoteCommandTimeoutMs`) | One wedged `docker build` starves every later deploy on that server forever | architecture #6 |
| 8 | Per-app mutex + coalesce pending jobs for the same app in `queue.ts`; add the `queued` status | 10 pushes = 10 sequential full builds; `NIXPLOY_DEPLOY_CONCURRENCY>1` collides on the same code dir | architecture #1, product Deploy |
| 9 | Real `/api/health` + `/api/ready` + `/api/version` (DB, docker ping, Traefik present, queue heartbeat → 503); point HEALTHCHECK, install probes and `nixploy doctor` at them; `--limit-memory` | Swarm never restarts a zombie panel; CLI has no compat signal | architecture #12, ops #3 |
| 10 | `update.sh` + in-app updater: `pg_dump` before rolling, `--update-monitor 60s` in the in-app path, downgrade guard | "Rollback" currently means previous image, not previous state | architecture #13, ops #6-7 |
| 11 | Log follower by byte offset + in-process emitter; drop the 500 ms per-client DB poll | 5 viewers on a 20 MB build log = 200 MB/s of file reads | architecture #5 |
| 12 | Index migration (`deployment(status)` partial, `created_at`, `schedule_id`; `incident`, `alert_rule`, `preview_deployment`, `rollback`) + retention job for `deployment` rows and `<config>/schedules/*.log` | Rows are never deleted; every `* * * * *` schedule adds 1 440 rows/day; hourly maintenance loads every id into memory | architecture #9-10 |
| 13 | Atomic + idempotent Traefik writes (tmp + rename, skip when hash unchanged) | Non-atomic writes into the watched dir; deploy storms become reload storms | architecture #11 |
| 14 | Release gate (`typecheck` + `test` w/ Postgres before tag/push) + PR builds of web/landing/cli/image + multi-arch images (M) | A red tree can become the auto-update channel; arm64 hosts silently source-build | ops #1, #4, #16 |
| 15 | `pnpm audit` fixes: `nodemailer` ≥ 9.1.1, MCP SDK bump (fast-uri/hono/qs), next patch for sharp; add `pnpm audit --prod --audit-level high` to CI | 6 high / 11 moderate advisories today | security 2.8 |

## 2. Product: what to build next

From [product-gaps.md](./product-gaps.md). Web uses 226/269 procedures, CLI 29, MCP 14.

1. **Deployment provenance + queue hygiene** — commit SHA/message/author/trigger on deployment rows, supersede pending jobs, `queued` status + queue-depth badge. Cheapest win on the most-used screen. (M)
2. **Traefik middleware layer for every domain type** — basic-auth/redirects on compose (tables are `applicationId NOT NULL` today), plus rate-limit, IP allow-list, headers, compression, forwardAuth, sticky; typed rows rendered by the single writer. (M)
3. **Shared variables** — org-level env has a reader but no writer/UI; build-only args separated from runtime env; `.env` import/export. (S each)
4. **Backup run history + local destination + restore verification** — the runner persists nothing; operators cannot see whether last night's backup ran. (M)
5. **Scoped API keys / service accounts + password reset + SSO** — keys are user-bound and unscoped; no forgot-password; `genericOAuth` for teams. (M)
6. **CLI / MCP parity from an allow-list** — lifecycle, databases, domains, env at all scopes, backups, servers, container logs; MCP read tools first. (M)
7. **Remote-server builders + optional registry push** — `setupServer` never installs nixpacks/railpack; `registry.imagePrefix` is stored but nothing pushes, so multi-node replicas cannot pull. (S + M)
8. **Wildcard / DNS-01 + per-domain HTTPS opt-out** — no wildcard certs; HTTPS redirect is global on the entrypoint. (M)
9. **Surface the half-built server features** — duplicate/move, `watchPaths`, `internalPath`, Swarm update/rollback/restart-policy forms, git-provider edit, tag edit, server metrics history, deploy-hook URL card; emit or drop the two dead notification toggles. All S, mostly UI.
10. **Pre/post-deploy hooks, preview knobs (env/cap/TTL), incidents ack/resolve, public status page.** (S–M)

## 3. Structural work (> 1 week each, in order)

1. **Durable deploy queue** — `queued` rows claimed with `FOR UPDATE SKIP LOCKED`, per-server + per-app concurrency, restart-safe resume, cancel-and-replace on new commits, queue position in the UI. Prerequisite for everything below. (architecture §4.1)
2. **Network segmentation** — `nixploy-internal` overlay for panel↔Postgres; per-service private networks for apps and DBs with Traefik attached per network; DB external ports opt-in. The single biggest posture change. (security roadmap 6)
3. **Container hardening defaults** — `CapabilityDrop ALL`, `no-new-privileges`, `PidsLimit`, log rotation, quota-derived resource limits; zod-validate the `z.unknown()` Swarm overrides. (security roadmap 7)
4. **Split the process** — `nixploy-worker` service for the deploy worker + crons, Postgres `LISTEN/NOTIFY` for status pushes; UI stays up during updates, worker memory-limited separately. (architecture §4.2)
5. **Metrics store** — append-only + compaction or a `metric_sample` table with rollups; one `listContainers` per pass instead of 3 + a 1 s `stats` per service; batch the N+1 env/alert-rule queries. (architecture #2-3)
6. **SSH transport** — per-server connection pool with keepalive, circuit breaker, reconciler grouped by server with bounded parallelism. (architecture #7)
7. **Push instead of poll** — one `/ws/events` stream consumed by TanStack Query invalidation; retire most `refetchInterval`s and the per-tab `docker ps` shell-outs. (architecture #14)
8. **Egress hardening + key rotation** — pin resolved IPs (undici `connect`), instance-admin toggle for private egress, `ENCRYPTION_KEYS` fallback list + re-encrypt script, build env off argv (`--env-file` 0600 / BuildKit `--secret`). (security roadmap 9-10)
9. **Streaming backups** — pipe dumps to S3 multipart; today > ~37 MB raw fails (base64 through a 50 MB buffer). (architecture #18)

## 4. Code health: refactor sequence

From [code-health.md](./code-health.md) §3. Each step is independently shippable.

1. **Error boundary** — `DomainError(code)` base in `modules/errors.ts`, `errorFormatter` in `trpc/init.ts`, Biome `noRestrictedImports` forbidding `@trpc/server` under `modules/**`; promote `bestEffort` with `log.debug` and replace the 45 `.catch(() => {})`. Today 226 `throw new Error` sites surface as HTTP 500 to REST/CLI/MCP. (~2 d)
2. **Service-kind registry** — one `SERVICE_REGISTRY[kind]` replacing the 7-way switch copied in 8 files; derive pgEnum/zod/web unions from it; deletes the 8 dynamic-dispatch `any`s. (~3 d)
3. **Transactions** — there are zero `db.transaction` calls; wrap `setServiceTags`, `applyStack`, `duplicate*`, `move*`, cascade deletes. (~2 d)
4. **Split the god modules + `src/test-utils`** — `webhook-handler` (956), `compose-file` (918), `backups/runner` (726), `monitoring/history` (670), `routers/monitoring` (648); then tests for `ws/access.ts`, `schedules/runner.ts`, a capability matrix over routers. (~4 d)
5. **Web form/hook consolidation** — `useSaveMutation`/`useDraft`/`useMounted`/`useDebouncedValue` for the 39 hand-rolled save forms; merge the schedules and backups duplicate panels; delete 5 unused shadcn files. (~3 d)

Deferred: `buildServiceRouter` folding application/compose lifecycle procs, `buildGitProviderRouter` for the four identical provider routers, shared zod schema package + CLI types from `AppRouter`, web/landing tsconfig strictness.

## 5. Ops, DR, CI and docs

From [ops-dx.md](./ops-dx.md) beyond the "do first" list:

- **DR**: dump with `--clean --if-exists`, reorder the restore doc (currently step 3 collides with step 1's migrations), add `tools/dr-restore-test.sh`, a DR checklist (RPO/RTO, restore to a new IP/domain).
- **Platform self-alerts**: disk %, oldest queued job age, `acme.json` cert expiry < 14 d, platform services at 0/1, "no instance backup in N days" → new `platformAlert` notification kind.
- **Install**: preflight for :80/:443, disk, memory, rootless Docker; `uninstall.sh`; DNS-vs-IP check before Let's Encrypt; firewall one-liners; offline recipe; `pg_isready` wait loop in the entrypoint; cron inputs labelled "(UTC)".
- **CI**: real e2e (boot the PR image + Postgres, run `golden-path-api.mjs`, later Playwright); `shellcheck`, Trivy, Dependabot, CodeQL, SBOM/provenance + cosign on GHCR images; Postgres 17 in CI; `pnpm test:db` that fails loudly without `DATABASE_URL_TEST`.
- **Tests**: zero coverage in `tags`, `audit`, `observability`, `notifications`, `db/`, all 42 routers, web, CLI. Start with provider payload snapshots, alert-rule evaluation tables, uptime transitions, router `createCaller` smoke.
- **Docs**: one runtime env table in `install.md` (11 knobs live only in the codebase map; 6 are not forwarded by the scripts), `troubleshooting.md` by symptom, `upgrade-notes.md`, platform-logs section in `observability.md`, `SECURITY.md` + issue/PR templates, commit a generic `tools/dev.sh`, complete `.env.example`.
- **CLI**: `user-agent: nixploy-cli/<v>` + version compat in `doctor`, `--json` everywhere, fetch timeout, profiles, `auth login` via stdin.

## 6. UX

From [ux.md](./ux.md), which drove the real panel end to end. Ranked:

1. **Human-readable errors** — zod failures reach every toast as a raw JSON array (verified on `project.create`, `domain.create`); FORBIDDEN/TIMEOUT shown verbatim. Same fix as §4 step 1: tRPC `errorFormatter` + a client `describeError()`. (S)
2. **Deploy pre-flight + follow the deploy** — Deploy is enabled on an unconfigured app, toasts success, fails 15 ms later with the reason two clicks away. Reject in the router, disable with a hint, jump to Deployments and open the log drawer, show the last error under the header. (M)
3. **Unify service pages** — three tab orders, three breadcrumb styles, Advanced sub-tabs not URL-synced. One `ServicePageHeader` + one tab order for application, compose and databases. (M)
4. **Unsaved-changes protection** — 39 per-card saves, no `beforeunload` or route guard anywhere; tab switches discard edits. (M)
5. **Unlock empty editors** — env/compose editors are blur-locked even when empty (three on one page). (S)
6. **Getting-started checklist** on the dashboard with live checks (panel domain/TLS, Git provider, first service/domain/deploy); create-application dialog takes the source up front. (M)
7. **Type-to-confirm for cascades** — project/environment delete is a plain confirm while single app delete requires the name. (S)
8. **Domain dialog guidance** — DNS hint with the public IP, certificate select only with HTTPS, inline traefik.me/LE validation, per-domain "Check DNS". (M)
9. **Activity tray + shared polling** — long ops end in a toast; `deployment.recent` polls every 5 s on every page forever. (M)
10. **Discoverability** — per-service palette destinations and shortcuts, docs links on risky toggles (there are none in the panel), sentence-case pass, one date formatter, `prefers-reduced-motion`. (S)

## 7. Suggested sequencing

| Sprint | Content | Outcome |
| --- | --- | --- |
| A (1–2 wk) | §1 items 1–15 | Every known High closed; restarts and updates stop corrupting deploys; releases gated |
| B (2–3 wk) | §4 step 1 + §6 items 1–5, 7 + §2 items 1, 3, 4, 9 | Readable errors everywhere; deploy feedback loop; unified service pages; no lost edits; provenance and queue state; shared env; backups observable; half-built features surfaced |
| C (3–4 wk) | §3 items 1–3 | Durable queue, tenant network isolation, hardened container defaults |
| D (ongoing) | §2 items 2, 5–8; §3 items 4–9; §4 steps 2–5; §5; §6 items 6, 8–10 | Middleware layer, scoped keys/SSO, CLI/MCP parity, worker split, metrics store, code-health refactors, CI e2e |

Update `docs/status.md` as items land; move closed rows out of the per-scope reports rather than editing them in place.
