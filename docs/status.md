# Repo status & working backlog

Living document. Every work session (human or AI) should refresh the snapshot
and move items between the backlog sections. Durable knowledge belongs in
[`../CLAUDE.md`](../CLAUDE.md) / [`codebase-map.md`](./codebase-map.md); this
file is for **state** and **tasks**.

## Snapshot — 2026-09-11 (end of the stability sweep + landing rebuild)

| Item | Value |
| --- | --- |
| Branches | `chore/sprint-1-hygiene` (14 commits over `main` @ `07ab3d4`) → `work/stability-and-landing` (16 more commits on top). **Neither pushed nor merged** — user decision. Merge order: sprint-1 first, then stability. |
| Tags / releases | PaaS `v0.1.0` (GitHub Release + GHCR), CLI `cli-v0.1.1` — unchanged. The stability branch is release-worthy as `v0.1.1`/`v0.2.0` once merged and CI is green. |
| Local toolchain | Node 22.21.0, pnpm 10.33.0, Docker 29.7.2, Swarm active |
| Key versions | Next 16.3.4 (web + landing), better-auth + api-key 1.7.3, React 19.2.8, Biome 2.5.12, zod 4.6.1, TanStack Query 5.102, lucide 1.43, commander 15, vitest 5.0.0, TypeScript 5.9.3, drizzle-orm 0.45.2 |
| `pnpm typecheck` | ✅ all 4 workspaces |
| `pnpm test` | ✅ 61 files, 886 passed with `DATABASE_URL_TEST` (1 skipped) |
| Biome (CI command) | ✅ 0 errors, 1 pre-existing warning (`services/danger-zone.tsx` `void \| Promise` onConfirm) |
| Builds | ✅ web (also without `DATABASE_URL`, the Docker scenario), landing (31 static routes), cli; Docker image built and booted healthy from a clean tree by the ops pass |
| REST e2e loop (`traefik/whoami` app → traefik.me domain → HTTPS via Traefik → stop/start/reload → env + port edit keeps inherited env → redeploy → rollback; uptime-kuma template → private net + Traefik → stop/start; compose safety probe → 400; postgres create/start/exec/stop/start/rename-guard/protected volume; docker/gitops/audit/monitoring/schedule (command + stdin script); cascade cleanup incl. volumes, YAML, dirs) | ✅ 58/59 on the final tree — the one miss is a resume artifact (latest deployment was the rollback), not a bug |
| UI verification | Both UI agents drove every touched page in light + dark (Playwright + in-app browser); 0 console / hydration errors after fixing three real hydration mismatches |
| Dev DB | `nixploy-dev-pg` (127.0.0.1:54329): `nixploy` (dev), `nixploy_test` (tenancy suite), `nixploy_e2e` (e2e user e2e@example.test) — all migrated to `0018` |
| Schema | 19 migrations (`0000`…`0018_needy_bloodstorm` = `server.swarm_node_id`) |
| Product | Phases 1–10 of `PLAN.md` shipped; 42 routers / ~300 procedures; 86 templates; 11 notification providers; MCP with 13 tools |

## What the stability sweep did (2026-09-10/11)

Seven read-only audits (deploy engine, compose/DB/templates, Traefik/domains/previews, auth/tenancy/API, integrations/jobs, ops scripts, web UI ×4 partitions) produced ~120 confirmed findings; six fix passes plus a remote-server redesign landed them. Each commit body on `work/stability-and-landing` lists exactly what changed. Highlights, most important first:

- **Security**: compose files are rendered before validation (the `$VAR` / `~` / `volumes.name:` bypasses gave tenants host root or other tenants' volumes); tenant env never reaches the docker CLI; per-app private networks stop cross-tenant DNS; host uniqueness across orgs (route hijack); WS 2FA gate + Origin check + container-label ownership; instance backups instance-admin only; volume prune guards; update image validation/quoting; reserved app names; invitation binding; per-key rate limits.
- **Broken features made real**: HTTPS on the default certificate (502), stack deploys (rejected by the current CLI), remote servers (Swarm calls now hit the primary, tasks pinned by `node.id`), custom git SSH keys, previews (ports/volumes/port/auth/fork refs), rollbacks (were an empty tab), deploy notifications (never emitted), backup exit status (silent empty dumps) and restores > 96 KB, GitOps diff/apply semantics (TLS downgrade + redeploy-everything), `update.sh` (crashed on every run), database volume orphaning, mongo replicaSet (never started — now rejected), fork-PR previews.
- **UI**: capability gating everywhere (viewers stop seeing controls that 403), error states instead of misleading empty copy, correct invalidations, better-auth `{ error }` handling, setup-wizard retry, status polling after deploy, log viewer reconnect stop, hydration fixes.
- **Landing**: rebuilt (`apps/landing`) and then redesigned to a strict monochrome layout (centered hero + framed dashboard shot, stack marquee, stats, statement, code-to-production accordion, 2×3 features, security, plan cards shared with `/pricing`, two-column FAQ, CTA). Theme tokens in `globals.css` are greys/white only; `components/ui.tsx` holds the shared `Button`/`WindowFrame`/`SectionHeading` primitives.

## Dependency upgrade candidates (remaining majors)

| Package | Current → Latest | Risk | Notes |
| --- | --- | --- | --- |
| `typescript` | 5.9.3 → 7.0.2 | **High** | Go-based compiler; verify Biome/drizzle-kit/tsup/Next plugin. Nothing needs it. |
| `@tanstack/react-table` | 8.21.3 → 9.2.4 | Medium | `components/data-table/*` + services table. |
| `nodemailer` | 9.0.3 → 10.0.2 | Low-Med | Email provider only. |
| `motion` (landing) | 12.43 → 13.2 | Low | magicui primitives. |
| `node-os-utils` | 2.0.4 → 3.1.0 | Low | Host monitoring. |
| `react` / `react-dom` | 19.2.8 → 19.3.0 | Low-Med | Bump with a Next release that lists 19.3. |
| `drizzle-orm` | 0.45.2 → 1.0.0-rc | Deferred | Wait for stable + drizzle-kit pairing. |

Image pins to review periodically: `traefik:v3.5.0`, `postgres:17-alpine`, `node:22-alpine`, `traefik/whoami:v1.10.1`, template images (CI checks tags exist, not freshness).

## Known debt / follow-ups (from the sweep, not yet done)

- [ ] **Remote servers**: stack-type compose on a remote must use registry-pullable images (`docker stack deploy` runs on the primary, no build); `docker.swarmServices` with a `serverId` returns the cluster-wide list (filter by `node.id` if per-server views are wanted); real multi-node smoke still pending (unit-tested only — no second host here).
- [ ] First-admin claim is serialized but the INSERT still happens after the hook; a fully atomic claim needs an `instance_setup` singleton row (migration).
- [ ] Redacted `env` / `composeFile` come back as `null`, indistinguishable from "unset"; add an explicit `redacted` flag to `one` responses (UI currently keys the read-only state on `can("secrets.read")`).
- [ ] `lib/safe-next-path.ts` rejects any `?query`, so `?next=/dashboard/projects/x?tab=domains` falls back to `/dashboard`.
- [ ] `schedule.create/remove` write no audit rows; `settings/incidents/page.tsx` has no `<title>`.
- [ ] Updater channel: install/update pin `NIXPLOY_IMAGE=…:vX.Y.Z`; `updates/settings.ts` tracks that ref, so release installs never see `:latest` moving — derive the channel (strip the tag → `:latest`, which now only moves on real releases) or add `NIXPLOY_UPDATE_IMAGE`.
- [ ] `tools/release.sh` is untracked locally (`.git/info/exclude`) although docs reference it — decide whether to track it.
- [ ] Landing docs (`apps/landing/src/lib/docs/pages.ts`) still hand-duplicate `docs/*`; the sweep's operator-facing changes (TRUSTED_PROXIES, invitation header, PG 18, mongo replica sets, instance backups admin-only, GitOps partial apply, remote-server placement) are in `docs/` but not mirrored on the site yet.
- [ ] `NEXT_PUBLIC_APP_URL` third fallback in the GitHub callback; better-auth logs `ERROR … Failed to validate API key` on every bad key.
- [ ] Large files still unsplit: `git/webhook-handler.ts`, `databases/engine.ts`, `routers/application.ts`.
- [ ] `deploymentStatus` has no `queued` value (queued rows show `running`).
- [ ] Local swarm leftovers from earlier smokes: service `hello-ac7e44`, stale `.nixploy-data/metrics/*.jsonl` (harmless).

## Next steps

0. **Work the improvement audit** — [`audits/2026-09/README.md`](./audits/2026-09/README.md): §1 "Do first" (15 small items: 4 security Highs, graceful shutdown, build timeout, queue mutex, health endpoint, pre-upgrade dump, log follower, indexes/retention, atomic Traefik writes, release gate, audit fixes), then product §2, structural §3, refactors §4.
1. **Merge** `chore/sprint-1-hygiene` then `work/stability-and-landing` into `main`, push, let CI + Docker run; cut a release (`./tools/release.sh paas --bump minor`) — the sweep changes operator-visible behaviour (installer env, compose rendering, remote servers), so `v0.2.0` is the honest number.
2. **Real multi-node test** of the remote-server path on a second Linux host (join as worker, pin an app + a database, deploy, stop/start, remove server).
3. Mirror the operator-facing doc changes onto the landing docs.
4. Follow-ups above, smallest first; then the remaining major upgrades.

## Session log

- **2026-09-10 (audit)** — Initial audit. Added `CLAUDE.md`, `docs/codebase-map.md`, this file.
- **2026-09-10 (sprint 1, branch `chore/sprint-1-hygiene`)** — hygiene, routine bumps, better-auth 1.7.3, Next 16.3.4 + `src/proxy.ts`, landing → Next 16, commander 15, vitest 5. All gates green.
- **2026-09-11 (improvement audit)** — six parallel read-only audits (security posture, architecture/scale, product gaps vs Dokploy/Coolify, ops/DX, code health, panel UX) → `docs/audits/2026-09/` with a sequenced plan in its README. Nothing fixed yet.
- **2026-09-10/11 (stability sweep + landing, branch `work/stability-and-landing`)** — 7 parallel audits → fixes per scope (see "What the stability sweep did"), remote-server redesign (`swarm_node_id` + `node.id` pinning, migration 0018), landing rebuilt then redesigned monochrome (2026-09-11), docs updated. Gates: typecheck 0/0, 886 tests, Biome clean, builds green, REST e2e loop 58/59 (resume artifact), UI driven light + dark. Nothing pushed.
