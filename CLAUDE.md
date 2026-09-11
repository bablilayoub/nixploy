# CLAUDE.md — Nixploy

Entry point for Claude Code sessions in this repo. Read in this order:

1. This file (commands, hard rules, gotchas).
2. [`AGENTS.md`](AGENTS.md) — shared agent conventions (also mirrored in `.cursor/rules/*.mdc` and `.agents/skills/nixploy-dev/SKILL.md`; keep all three in sync when a convention changes).
3. [`docs/codebase-map.md`](docs/codebase-map.md) — where every subsystem lives, entry points, data flow.
4. [`docs/status.md`](docs/status.md) — dated health snapshot, dependency upgrade candidates, known debt, working backlog. **Update it at the end of every work session.**

Product intent: [`PLAN.md`](PLAN.md) (Phases 1–10 shipped). Operator/contributor guides: [`docs/README.md`](docs/README.md).

## What this is

Nixploy is a self-hosted PaaS (Dokploy/Coolify-class): one Node process (Next.js 16 App Router with a custom `server.ts`) that hosts the UI, tRPC, a REST/OpenAPI adapter, an MCP endpoint, WebSocket streams, an in-memory deploy queue and node-schedule crons. It drives a single-node Docker Swarm (remote servers join it over SSH) and writes Traefik v3 file-provider YAML for routing/TLS.

pnpm monorepo:

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@nixploy/web` | Next.js panel: UI, `/api/trpc`, `/api/<router>.<proc>` REST, `/api/mcp`, `/swagger`, custom `server.ts` (WS + queue + crons) |
| `packages/server` | `@nixploy/server` | Drizzle schema + migrations, better-auth, tRPC routers, deploy engine, builders, Traefik/Docker utils, backups, notifications, templates, MCP tools |
| `apps/cli` | `@nixploy/cli` | Published npm CLI over the REST API (`x-api-key`) |
| `apps/landing` | `@nixploy/landing` | nixploy.com marketing site (Next.js 16, separate from the panel) |
| `docker/` | — | Production Dockerfile, entrypoint (migrate-then-start), Traefik static config, dev compose |
| `install.sh` / `update.sh` | — | Production installer / updater (Swarm services `nixploy`, `nixploy-postgres`, `nixploy-traefik`) |
| `tools/` | — | `release.sh` (tag-driven releases), `golden-path-api.mjs` (API smoke), `screenshots/` (separate npm project, Playwright captures) |

## Commands

Run everything from the repo root unless stated.

```bash
pnpm install                                   # ALWAYS at the root, never inside one package
pnpm typecheck                                 # tsc --noEmit across all 4 workspaces
pnpm -F @nixploy/server exec tsc --noEmit      # fast server-only typecheck
cd apps/web && pnpm exec tsc --noEmit          # fast web-only typecheck
pnpm exec biome check --write <files>          # lint + format changed files (tabs, double quotes)
pnpm exec biome check packages/server apps/web apps/cli apps/landing   # what CI runs
pnpm test                                      # vitest in packages/server (offline; tenancy suite skips without DATABASE_URL_TEST)
DATABASE_URL_TEST=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy_test pnpm test   # full suite incl. tenancy isolation
pnpm test:template-images                      # registry manifest probe for every template image (network)
pnpm db:generate                               # new Drizzle migration after editing packages/server/src/db/schema/*
pnpm db:migrate                                # apply migrations to DATABASE_URL (apps/web/.env is NOT auto-loaded here — export it or use ./dev.sh)
pnpm db:studio                                 # Drizzle Studio
cd apps/web && pnpm dev                        # panel on :3000 (loads apps/web/.env itself)
cd apps/web && set -a && . ./.env && set +a && pnpm build   # production build (needs env)
cd apps/landing && pnpm dev                    # landing on :3001
pnpm -F @nixploy/cli typecheck && pnpm -F @nixploy/cli build
./dev.sh                                       # local one-shot: Postgres container + panel + landing (untracked helper, gitignored)
pnpm smoke:golden-path                         # needs NIXPLOY_URL + NIXPLOY_API_KEY against a running panel
./tools/release.sh paas --bump patch --dry-run # release flow preview (see docs/releases.md)
```

Dev database: Docker container `nixploy-dev-pg` on `127.0.0.1:54329` (user/pass/db `nixploy`). If it is stopped: `docker start nixploy-dev-pg`. Docker Swarm must be active (`docker swarm init`). Traefik and the `nixploy-network` overlay are auto-provisioned on panel boot (skip with `NIXPLOY_DISABLE_TRAEFIK_BOOT=1`).

## Hard rules (do not violate)

- **Tenancy.** `organization → project → environment → service`. Every tenant-scoped procedure is `protectedProcedure` and resolves the org via `resolveCallerOrganizationId(userId, activeOrganizationId)` (`modules/projects`) or `ctx.organizationId()` / `getOrganizationId(session)` (memoized per request). Never read `session.activeOrganizationId` raw, never throw when it is null, always filter rows by the resolved org (`assertApplicationAccess`, `assertEnvironmentAccess`, `getServiceContext` in `modules/application/org.ts`).
- **Authorization.** Mutations gate with `assertCapability(userId, orgId, "<capability>")` (catalog in `modules/projects/capabilities.ts`; `hasCapability` for soft gates such as secret masking). Role ladder `viewer < member < deployer < admin < owner` via `assertOrgRole` where a coarse gate is enough. Record meaningful mutations with `auditFromSession` (fire-and-forget).
- **Routers.** One file per domain in `packages/server/src/trpc/routers/<kebab>.ts`, export `<name>Router`, register in `trpc/root.ts`. Unregistered = unreachable from tRPC, REST, CLI and MCP. Routers stay thin; logic lives in `modules/<domain>/` with vitest tests next to the code. Zod on every input.
- **Secrets at rest.** `encryptedText` / `encryptedJson` columns (AES-256-GCM, `ENCRYPTION_KEY`) for env vars, passwords, tokens, S3 keys, notification configs. Redact on read for viewers (`trpc/redact-secrets.ts`). Never log tokens; keep passwords off argv (`execAsyncWithStdin`).
- **Shell/Docker.** `execAsync` (host) / `execAsyncRemote(serverId)` (SSH) from `utils/exec.ts`, or `spawnTargeted` / `getDocker(serverId)` from `modules/deployment/docker.ts` for streaming + dockerode. No raw `child_process` in feature code. Always `shellQuote` user-controlled values.
- **Paths.** Never hardcode `/etc/nixploy`. Use the helpers (`getConfigDir`, `getAppCodePath`, `getDeploymentLogPath`, `getDynamicDir`, …). Note there are currently four `getConfigDir` variants (see gotchas).
- **Traefik.** Only `writeAppTraefikConfig` / `removeTraefikConfig` (`modules/traefik`) write dynamic YAML. Never hand-write YAML in feature code.
- **Deployments.** Only through `queueDeployment` (`modules/deployment/index.ts`). Never spawn builds from a router.
- **Service kinds.** Never hand-write the seven-way `application | compose | postgres | mysql | mariadb | mongo | redis` union or a `switch` over it. Import `SERVICE_KINDS` / `ServiceKind` from `modules/services/kinds` (import-free on purpose — the panel bundles it) and dispatch through `SERVICE_REGISTRY[kind]` (`modules/services/registry`); zod inputs use `serviceKindSchema` / `databaseKindSchema`. The registry asserts the `service_type` pgEnum matches at import. Adding a kind: `docs/codebase-map.md` § "Service registry".
- **Transactions.** Multi-row writes take `executor: DbExecutor = db` (from `db/index.ts`) and the caller wraps them in `db.transaction(...)`. Swarm, Traefik and file side effects stay outside the transaction (best-effort via `bestEffort`, cannot be rolled back).
- **Errors.** Modules throw `DomainError` (`modules/errors.ts` helpers `badRequest` / `notFound` / `conflict` / `forbidden` / `preconditionFailed` / `timeout`), never `TRPCError` (Biome blocks `@trpc/server` under `modules/**`). `trpc/init.ts` is the only mapping point — its middleware + `errorFormatter` (zod issues flattened to `field: message`, structured under `data.zodIssues`) mean the REST adapter and MCP inherit it. Side effects that must not fail the caller go through `bestEffort(label, fn)` (`utils/best-effort.ts`); web toasts go through `toastError` / `describeError` (`apps/web/src/lib/describe-error.ts`), never `toast.error(error.message)`.
- **Egress.** Outbound requests to user-controlled hosts go through `utils/public-url.ts`: the guards (`assertSafeOutboundUrl` / `assertPublicHttpsUrl` / `assertSafeSmtpHostname` / `assertSafeGitCloneUrl`) return a `SafeTarget` (`{ url, addresses, isPrivate }`) and `pinnedFetch(target, init)` dials only those addresses. Never call global `fetch` on a tenant URL and never connect to `url.hostname` after the check (DNS rebinding). `allowPrivate: true` at a call site is a request ANDed with the instance toggle `webServer.allowPrivateEgress` (default off, `NIXPLOY_ALLOW_PRIVATE_EGRESS=1` forces it); the Swarm overlay and platform service names stay blocked either way.
- **Schema changes.** Edit Drizzle schema → `pnpm db:generate` → commit the SQL migration (hand-edit when Postgres needs `USING` casts or a backfill before `SET NOT NULL`). Keep `db/schema/auth.ts` in sync with the better-auth plugin version.
- **Dependencies.** The workspace dependency set is deliberately fixed. Do not add packages without saying why; upgrades go through `docs/status.md` first.
- **Style.** Biome: tabs, double quotes, semicolons, trailing commas, named exports, line width 100. Match surrounding code. Minimal diffs, no speculative abstractions.
- **Web.** `useTRPC()` from `@/lib/trpc` with `queryOptions` / `mutationOptions`, invalidate by `queryKey`. shadcn primitives in `@/components/ui`, lucide icons, sonner toasts (sentence case — and sentence case for every label, button and dialog title too; only proper nouns keep capitals). Every list surface ships loading skeleton + error-with-retry + empty state (`components/query-state.tsx`). Log rendering through `components/services/log-viewer.tsx`, charts through `monitoring-charts.tsx`. Gate client-only rendering behind a mounted flag. `useSearchParams` needs a `<Suspense>` boundary.
- **Docs.** When behaviour changes, update the matching guide in `docs/` and, if operator-facing, the landing docs (`apps/landing/src/lib/docs/pages.ts` duplicates parts of `docs/` by hand — drift is a known risk).

## Verification loop (before declaring anything done)

1. `pnpm -F @nixploy/server exec tsc --noEmit` (server) and/or `cd apps/web && pnpm exec tsc --noEmit` (web), `pnpm -F @nixploy/cli typecheck` (cli), `pnpm -F @nixploy/landing typecheck` (landing).
2. `pnpm exec biome check --write <changed files>` from the root.
3. `pnpm test` (add `DATABASE_URL_TEST` when touching routers or tenancy — CI runs the full suite against Postgres).
4. Bigger UI work: `cd apps/web && pnpm build` with env loaded, then drive the real app (Playwright via `tools/screenshots`, or the in-app browser) and check light **and** dark mode, watching the console for hydration warnings.
5. Touching the deploy path: smoke-test against the local Swarm (deploy `traefik/whoami`, attach a `*.traefik.me` domain, hit it through Traefik).
6. Report results honestly: quote failing output, say what was skipped.

## Gotchas found in the 2026-09 audit

Details and status live in `docs/status.md`; this is the short list you must not trip over.

- `getConfigDir` (config root) and `getSwarmNetwork` (overlay network) each have exactly one implementation now: `modules/deployment/paths.ts` and `modules/application/paths.ts`. Other `paths.ts` files re-export them. Never add another `process.env.NIXPLOY_CONFIG_DIR` / `NIXPLOY_NETWORK` read; on macOS dev the config root falls back to `./.nixploy-data` when the env var is unset.
- `apps/web/server.ts` imports cron modules via relative `../../packages/server/src/...` paths on purpose (single module instance under tsx). Do not "fix" them into package specifiers without checking the queue/worker singleton still holds.
- `deploymentStatus` is `queued → running → done | error | cancelled` and the `deployment` table **is** the queue: `queueDeployment` inserts `queued` (superseding an older queued row for the same `app_name` in one transaction under an advisory lock) and the worker claims with `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`, so FIFO per server, the per-app mutex and exactly-once claiming live in SQL and a backlog survives restarts. Boot recovery fails abandoned `running` rows and rows without `app_name`; queued rows are simply claimed by the loop. Only slot accounting, cancellation and child-process handles are process-local, kept on `globalThis` because Next's `transpilePackages` evaluates `packages/server` modules twice (route chunks vs `server.ts`) — any new process-wide singleton in `packages/server` must do the same (see `deployment/events.ts`).
- `apps/web/pnpm-lock.yaml` is a stale tracked artifact from before the workspace lock; the real lock is the root `pnpm-lock.yaml`.
- `NEXT_PUBLIC_APP_URL` is only read server-side as the third fallback for the GitHub App callback origin (`api/github/callback/route.ts`: `BETTER_AUTH_URL` → `NIXPLOY_BASE_URL` → `NEXT_PUBLIC_APP_URL`). The client bundle never bakes a URL in; do not add `NEXT_PUBLIC_*` URLs.
- The dashboard cookie gate lives in `apps/web/src/proxy.ts` (Next 16 `proxy` convention; `middleware.ts` is deprecated). It **must** sit under `src/` — Next only scans the parent of the app dir for `proxy.ts`, and a root-level file is silently ignored (verified: empty middleware manifest, no `ƒ Proxy` line in the build). It must stay database-free; authoritative session checks happen in `(dashboard)/layout.tsx`.
- `better-auth` + `@better-auth/api-key` are pinned to the same exact version in `apps/web` and `packages/server` (1.7.3). When upgrading: bump both, diff the plugin schemas (runtime-introspect `plugin.schema` for organization/admin/twoFactor/apiKey and `getAuthTables` from `better-auth/db`) against `db/schema/auth.ts`, then run the full manual loop (setup → 2FA enroll → sign-out → sign-in with TOTP → API key → REST + MCP → invite). The drizzle adapter reads `db._` at construction; `db/index.ts` answers that with `undefined` when `DATABASE_URL` is unset so offline tests and `next build` keep working.
- The landing site and the panel are separate Next apps (both 16.3 now). Keep their `next` versions moving together; a build of one does not exercise the other.
- The tenancy suite (13 tests) silently skips without `DATABASE_URL_TEST`. A green local `pnpm test` does not prove tenant isolation.
- `docker/Dockerfile` deps stage copies only `apps/web`, `apps/cli`, `packages/server` package manifests (no `apps/landing`); CI image builds are green, so leave it unless adding a workspace the image needs.
- The in-memory deploy queue and rate limiters are process-local: multi-replica `nixploy` is unsupported by design.
- **Network model (2026-09-11)**: `nixploy-internal` carries the panel, Postgres and Traefik's dashboard route (no tenant workload); `nixploy-network` is joined only by Traefik and services that currently have a domain (`syncApplicationSharedNetwork` attaches/detaches on domain mutations); every application, database and compose stack joins a per-environment overlay (`<env-slug>-<id8>-net`); compose stacks keep their own `<appName>-net`. Do not attach Traefik per app — a network change recreates the Traefik task (~9 s proxy outage, measured). The panel never reaches managed databases over the overlay (always `docker exec`). Cross-environment DNS is gone on purpose.
- **Container baseline** (`deployment/swarm.ts`, `databases/engine.ts`, compose injection): `CapabilityDrop ALL` + seven caps (no `NET_RAW` — ICMP monitors inside containers stop working), `no-new-privileges`, pids 1024, nofile 65536, rotating json-file logs, org quota `maxCpuShares`/`maxMemoryMb` applied as default `Resources.Limits`. Relaxing needs the instance admin via `application.privilegesSwarm`.
- **Deploy hooks**: `docker run <image> sh -c …` is swallowed by image ENTRYPOINTs — hooks must pass `--entrypoint sh` (`deployment/hooks.ts`). Exit 127 means the image has no `/bin/sh`.
- **HTTPS redirect is per router** (`redirectScheme` emitted for `https: true` domains); there is no entrypoint-level redirect any more, so a domain with `https: false` is served plain.
- **Dev servers**: Next 16 holds `apps/web/.next/dev/lock` — one dev server per checkout at a time; `BETTER_AUTH_URL` must match the port you run on; use `http://localhost:<port>`, never `127.0.0.1` (rejected as a cross-origin dev host). A stale `apps/web/.next` production build serves OLD server code on the request path — `pnpm build` again before smoking with it.
- Compose files are **rendered** before validation and deploy (`modules/compose/compose-file.ts`): every `$VAR`/`${VAR}` is resolved from the merged env, the safety checks run on raw + rendered specs, and docker commands run under `env -i` with `--env-file /dev/null`. Never pass tenant env into the docker CLI's process environment, never validate only the raw file. Every service gets a private `<appName>-net`; only Traefik targets join `nixploy-network`.
- Server host-key pins live in `<config>/ssh/pinned-hosts/`; git clones use `<config>/ssh/git_known_hosts` via `buildGitSshCommand` (`modules/deployment/sources.ts`). Do not point `UserKnownHostsFile` at a directory again.
- Anything that can exceed a few KB (archives, certificates, scripts, compose files) is sent to remote shells over stdin (`execAsyncWithStdin` / `writeFileTargeted`), never as a base64 argv blob (128 KiB kernel cap, visible in `ps`).
- The web app gates controls with `useCapabilities()` (`apps/web/src/hooks/use-capabilities.ts`, backed by `organization.myCapabilities` + the session role). Hide or disable, never rely on it alone — the server checks stay authoritative.
- Every service page (application, compose, the five databases) renders `components/services/service-page-header.tsx` and one tab order: **General · [Compose file | Connection] · Deploy · Runtime · Domains · Environment · Backups · Advanced · Settings** (each kind renders only the tabs it has). Tab ids are URL-synced through `useSyncedTab`; **when you retire a tab id, add it to `SERVICE_TAB_ALIASES` in `hooks/use-synced-tab.ts`** or shared deep links break. Advanced sub-tabs live in their own `?advanced=` param.
- One query drives "what is deploying": `hooks/use-running-deployments.ts` (`deployment.recent`, polled only while something is queued/running). The header, deploy hairline, services table, dashboard list and `layout/activity-tray.tsx` all read it — never add another `refetchInterval` on deployments. Long operations that are not deployments register with the tray via `useTrackedActivity` / `trackActivity`.
- Risky options get a `<HelpLink slug="…">` (`components/ui/help-link.tsx`) pointing at `nixploy.com/docs/<slug>`; the slug must exist in `apps/landing/src/lib/docs/pages.ts`.
- **Compose previews (2026-09-11)**: a preview is a whole compose *project* named `<appName>-pr-<n>` (private network `<appName>-pr-<n>-net`, Traefik keys `<appName>-pr-<n>-<service>`), built through one `PreviewParent` lifecycle shared with applications (`modules/preview/parent.ts`). A preview render passes `deploymentId: null` to `prepareComposeFiles` — a preview shares the parent's `composeId`, and a snapshot would offer a PR's file as a production rollback target. Preview domains carry `composeId` but are filtered out of `exposedServiceNames` / `resyncComposeDomains`.
- **Compose Traefik upstreams**: the config key for a compose service (`<app>-<svc>` / `<app>_<svc>`) *is* the resolvable upstream name (the alias `injectNetwork` adds on `nixploy-network`). Never leave `serviceName` set on a `TraefikDomainEntry` for compose — the writer appends `-<svc>-1` to the key and routes to a name that does not exist (every compose domain 502'd this way until 2026-09-11).
- **simple-git guards**: `gitProtocolEnv()` passes `protocol.allow=never` through `GIT_CONFIG_COUNT`, which simple-git refuses by default (`allowUnsafeConfigEnvCount`, `allowUnsafeProtocolOverride`). Local clones go through `hardenedSimpleGit(baseDir)` + `git.env(gitProcessEnv(gitEnv))` (`modules/deployment/sources.ts`) — never `simpleGit({ baseDir })` with `{ ...process.env }` (the `GIT_EDITOR` guard trips and secrets leak into git children). Remote clones are a shell command with an env prefix and never touch simple-git.
- **Scripting against the deploy engine**: `queueDeployment` starts the claim loop in the calling process. A short-lived script that enqueues and exits can claim its own job and abandon it `running` — enqueue over REST, or keep the process alive until the row is terminal.
- **Process roles (2026-09-11)**: `NIXPLOY_ROLE` = `all` (default) | `panel` | `worker`, read only through `lib/role.ts`. `startQueueLoop()` is a no-op for `panel`; anything that assumes "enqueue ⇒ this process builds it" is only true for `all`/`worker`. Registering the deploy job runner is a side effect of importing `modules/deployment/index.ts` (the claim loop refuses to claim while it is null) — any entry that starts the loop outside a Next request must import it explicitly (`apps/web/worker.ts` does). Cross-process wake-ups/cancel/events ride Postgres `LISTEN/NOTIFY` (`db/listen.ts`, `deployment/notify.ts`); deployment log chunks never do (8000-byte cap) — the log file on the shared volume is the source of truth. Both halves listen on `nixploy_events`, so frames carry a per-process origin and the listener drops its own echo.
- **Push, not poll**: `/ws/events` + `hooks/use-live-events.ts` invalidate queries on deployment/queue/service-status frames; a `refetchInterval` is only acceptable as `live ? false : <ms>` via `useLiveEventsConnected()`, or for genuinely periodic time-series (metrics). Docker listings go through `dockerListingCache` in `modules/docker/containers.ts` — call `invalidateDockerListings(serverId)` after any lifecycle mutation.
- **SSH**: `utils/ssh-pool.ts` owns every ssh2 client (bounded channels, keepalive, idle close, per-server breaker that short-circuits with `preconditionFailed` for 5 min after 3 failed connects; read via `server.transportState`, closed by `server.testConnection`/`setup`). Never construct an ssh2 `Client` elsewhere; remote fan-out in crons goes through `utils/fan-out.ts` and skips `isServerUnreachable(serverId)`.
- **Secrets and keys (2026-09-11)**: `ENCRYPTION_KEYS="new,old"` (first encrypts, all decrypt) supersedes the single `ENCRYPTION_KEY`; passphrases are scrypt-stretched (`v2:` ciphertexts), hex keys stay `v1:`; boot refuses `.env.example` placeholders. Rotate with `pnpm -F @nixploy/server nixploy:rotate-key` (discovers every `encryptedText`/`encryptedJson` column from the schema). Build env never rides argv: nixpacks/railpack source a 0600 file (`--env NAME` only), `pack` gets `--env-file`, Dockerfile builds pass credential-shaped keys as BuildKit `--secret` (`builders/build-env.ts`).
- **Rate limits trust forwarded headers only from a trusted socket peer**: `server.ts` stamps the TCP peer into `x-nixploy-peer-ip` (dropping any client copy) and `utils/rate-limit.ts` checks it against `TRUSTED_PROXIES` / the private proxy ranges. Route handlers that need the client IP call `clientIpFromRequest` / `clientIpFromHeaders`, never read `x-forwarded-for` themselves.
- **Audit rows** carry `ip`, `userAgent`, `organizationName`, and `organizationId` is nullable (`ON DELETE SET NULL`) so history survives org deletion. Every mutation in a router writes exactly one row via `auditFromSession`; `audit.export` returns CSV; `NIXPLOY_AUDIT_FORWARD=1` mirrors rows to platform alerts.
- **Database backups stream** (`backups/stream-exec.ts` → S3 multipart or a 0600 file); the ~37 MB base64 ceiling only applies to instance/volume/redis archives now. `stream-exec.ts` is the one place besides `utils/exec.ts` that touches `child_process`/`ssh2`.
- **Web save forms**: every service tab is wrapped in `SaveBarTabsContent` (TabsContent + `SaveBarProvider`) and the settings layout mounts one provider — `useSaveBar` registrations are no-ops without a provider above them. Forms use `useDraft` + `useSaveMutation` + `useSaveBar`; guarded `Tabs` roots use `activationMode="manual"` (automatic activation fires `onValueChange` twice per click and double-prompts the dirty guard). `apps/web` has a vitest suite (`pnpm -F @nixploy/web test`) that borrows the runner from `@nixploy/server`.
- `TRUSTED_PROXIES=1` is set by the installer (panel is only reachable through Traefik). Without it every client IP is "unknown"; API-key limits are per key anyway, webhook/setup limits degrade to a wide shared bucket.

## Working agreement for Claude

- Prefer small, focused commits. Commit only when asked. Commit messages: conventional (`fix:`, `feat:`, `chore:`), body explains why. Never push tags (`v*`, `cli-v*`) casually — they trigger releases.
- Before large cleanup, check `docs/status.md` backlog so work is not duplicated and mark items in progress / done there.
- When you learn something non-obvious about this codebase, put it in `docs/status.md` (if it is a task) or `docs/codebase-map.md` / this file (if it is durable knowledge), not only in chat.
- Never run `pnpm install` inside a single workspace package. Never edit generated files under `packages/server/drizzle/meta/` by hand.
- `.nixploy-data/` (local runtime state), `apps/web/.env`, `dev.sh` are local-only. Never commit them or paste their secrets.
