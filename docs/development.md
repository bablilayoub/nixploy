# Development setup

Contributor overview (clone → PR): [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Quick start

```bash
git clone https://github.com/bablilayoub/nixploy && cd nixploy
./tools/dev.sh
```

`tools/dev.sh` checks the toolchain, starts (or creates) the `nixploy-dev-pg`
container on `127.0.0.1:54329`, writes `apps/web/.env` from
`.env.example` with real random secrets on first run, applies the migrations
and runs the panel on **:3000** and the landing site on **:3001** until
Ctrl+C. `--no-landing`, `--skip-migrate`, `--skip-install` and
`--no-postgres` do what they say.

Everything below is the same thing done by hand, plus the details the script
cannot decide for you.

## Prerequisites

- Node ≥ 22 (`.nvmrc` pins the major — `nvm use` picks it up), pnpm ≥ 10
  (`corepack enable` gives you the pinned pnpm).
- Docker Desktop (or any Docker daemon) with **Swarm active**:
  `docker swarm init` once if `docker info | grep Swarm` says `inactive`.
- A local PostgreSQL 17 for the app database. Quickest throwaway instance:

```bash
docker run -d --name nixploy-dev-pg \
  -e POSTGRES_USER=nixploy -e POSTGRES_PASSWORD=nixploy -e POSTGRES_DB=nixploy \
  -p 54329:5432 postgres:17-alpine
```

(`docker/docker-compose.dev.yml` can instead boot Postgres **and** the full
app in containers — useful for smoke-testing the production image.)

## Environment

`apps/web/.env` (see `apps/web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | App database, e.g. `postgres://nixploy:nixploy@127.0.0.1:54329/nixploy` |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth signing + base URL (`http://localhost:3000`) |
| `ENCRYPTION_KEY` | AES key for `encryptedText` columns (env vars, DB passwords, tokens) |
| `NIXPLOY_CONFIG_DIR` | Where app code, compose files, logs and Traefik dynamic YAML live. Dev default: `.nixploy-data/` at the repo root; production: `/etc/nixploy` |
| `NIXPLOY_NETWORK` | Shared overlay network name (default `nixploy-network`) |

Generate secrets once:

```bash
openssl rand -hex 24   # BETTER_AUTH_SECRET
openssl rand -hex 16   # ENCRYPTION_KEY
```

## Run

```bash
pnpm install
pnpm db:migrate                 # apply Drizzle migrations to DATABASE_URL
cd apps/web && pnpm dev         # http://localhost:3000 (loads .env itself)
```

Optional landing site: `cd apps/landing && pnpm dev` → http://localhost:3001.

First run: open `/setup` on a fresh database to create the owner account
(public `/register` is removed). An organization `<name>'s Org` is created
during setup and becomes your active org. The dev server boots
Traefik (`nixploy-traefik` swarm service) and the overlay network
automatically on start.

## macOS / laptop notes

The panel is written for a Linux host with a root Docker daemon. On a laptop
four things bite, in this order:

- **UI-only mode: `NIXPLOY_DISABLE_TRAEFIK_BOOT=1`.** By default the panel
  bootstraps Traefik on boot: it renders `traefik.yml`, generates a
  self-signed certificate and creates the `nixploy-traefik` global service,
  which host-publishes **:80 and :443**. On a machine that already runs a
  local web server (or where you simply do not want a proxy grabbing
  privileged ports) that is the wrong default. Set the variable in
  `apps/web/.env` and the boot step is skipped entirely — everything except
  real domain routing still works, and `/api/ready` reports Traefik as a
  warning rather than a failure. Unset it when you actually want to test
  domains and TLS end to end.
- **:80 / :443 collisions.** Swarm host-mode publishing cannot bind to
  loopback only, so `nixploy-traefik` takes those ports on every interface.
  Nothing else can hold them at the same time — stop the other server, or use
  the UI-only mode above. `docker service rm nixploy-traefik` frees them; the
  next panel boot recreates the service unless the variable is set.
- **One dev server at a time.** Next 16 takes an exclusive
  `apps/web/.next/dev/lock`. A second `pnpm dev` (or a `pnpm build` racing a
  running dev server) fails or hangs on it. Stop the first one; if a process
  was killed hard, delete the stale lock before starting again.
- **`BETTER_AUTH_URL` must match the port you browse to.** It is the trusted
  origin, not a display string: running on `PORT=3136` while
  `BETTER_AUTH_URL=http://localhost:3000` makes every sign-in fail with
  "Invalid origin". Change both together.

Two more things that are Linux-only and silently degrade here: the config dir
falls back to `./.nixploy-data` when `NIXPLOY_CONFIG_DIR` is unset (writing to
`/etc` needs sudo on macOS), and host metrics read `/proc`, which does not
exist — the Host card shows what Docker Desktop's VM reports, not your Mac.

## Verify changes (the loop)

```bash
pnpm -F @nixploy/server exec tsc --noEmit      # server types
cd apps/web && pnpm exec tsc --noEmit          # web types
pnpm exec biome check --write <changed files>  # lint/format (repo root)
pnpm test                                      # vitest (packages/server), offline
DATABASE_URL_TEST=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy_test \
  pnpm test:db                                 # …plus the Postgres-backed suites
pnpm -F @nixploy/cli test                      # vitest (apps/cli, 83 tests)
pnpm -F @nixploy/web test                      # vitest (apps/web unit tests)
cd apps/web && pnpm build                      # full production build (before shipping UI work)
```

### `pnpm test` vs `pnpm test:db`

`pnpm test` is the offline run: the three Postgres-backed suites
(`trpc/tenancy.test.ts`, `modules/deployment/queue.db.test.ts`,
`modules/tags/tags.db.test.ts`) `describe.skipIf` themselves when
`DATABASE_URL_TEST` is unset, so a green `pnpm test` proves nothing about
tenant isolation.

`pnpm test:db` ([`tools/test-db.mjs`](../tools/test-db.mjs)) closes that hole:
it **refuses to run** without `DATABASE_URL_TEST` (printing the exact local
connection string and the one-time `createdb` + `db:migrate` recipe), runs
vitest with `--reporter=verbose`, and prints a flat inventory of every skipped
test afterwards — with an extra warning if one of the Postgres-backed suites
skipped anyway. CI runs `test:db`, so a missing env var fails the job instead of
silently shrinking the suite.

[`packages/server/vitest.config.ts`](../packages/server/vitest.config.ts) splits
the run into two projects for this reason. `unit` is everything else and runs in
parallel; `db` matches `src/**/*.db.test.ts` plus `src/trpc/tenancy.test.ts` and
sets `fileParallelism: false`. They share one `nixploy_test` database and their
claim/visibility semantics are database-wide by design (the durable-queue suite
asserts on `FOR UPDATE SKIP LOCKED` across the whole table), so two of those
files running at once flakes. Name a new Postgres-backed suite `<name>.db.test.ts`
and it joins the serialized project automatically.

`apps/web` carries no `vitest` dependency of its own: the runner and its
types are borrowed from `@nixploy/server` (the `test` script shells through
`pnpm -F @nixploy/server exec`, `tsconfig.json` maps the `vitest` types
there). `apps/cli` used to do the same, but its 83 tests now justify a direct
`vitest` devDependency pinned to the server's version, so `pnpm -F @nixploy/cli
test` is a plain `vitest run`. The web suite is `node`-environment only
— pure modules such as `lib/safe-next-path.ts`, `lib/describe-error.ts`,
`lib/format.ts`, `lib/env-file.ts` and the pure halves of `useSyncedTab` /
`useDraft`. There is no jsdom and no testing-library, so components are
verified by driving the real panel, not by rendering them in a test.

For UI changes, also drive the real app headlessly with Playwright
(`playwright-core`): log in, exercise the flow, screenshot the surfaces you
touched in light and dark mode. Ask before `pnpm install`-ing inside a single
workspace package — run installs at the repo root so workspace symlinks stay
intact.

### End-to-end against a running panel

Two scripts, both of which CI runs on every PR against the image built from that
PR (the `e2e` job below). Point them at any panel — a local `pnpm dev`, a
container, a staging host.

```bash
# 1. First admin + organization + API key, the way /setup does it in a browser.
#    Prints the key on stdout; safe to re-run (falls back to sign-in).
KEY=$(NIXPLOY_URL=http://localhost:3000 \
      E2E_EMAIL=e2e@nixploy.test E2E_PASSWORD='E2e-ci-password!1' \
      node tools/bootstrap-instance.mjs)

# 2. The REST golden path: project → docker app (traefik/whoami) → deploy →
#    deployment done with provenance → *.traefik.me domain → HTTP(S) through
#    Traefik → stop → start → Postgres service → local backup destination →
#    backup run → runs list → delete project → assert no Swarm leftovers.
NIXPLOY_URL=http://localhost:3000 NIXPLOY_API_KEY="$KEY" node tools/golden-path-api.mjs

# 3. The UI golden path: login → project → application → docker source →
#    Deploy → "Succeeded" → domain dialog → every surface in light and dark
#    with a clean-console assertion → delete the project again.
BASE_URL=http://localhost:3000 \
  E2E_EMAIL=e2e@nixploy.test E2E_PASSWORD='E2e-ci-password!1' \
  E2E_SHOTS=/tmp/ui-shots node tools/e2e-ui.mjs
```

Both clean up after themselves — a green run leaves no project, Swarm service,
Traefik YAML or container behind, and `golden-path-api.mjs` deletes its project
even when a step fails. `SMOKE_KEEP=1` disables that while debugging.

`tools/e2e-ui.mjs` finds a browser in this order: `playwright` (what CI installs
into a scratch prefix, pinned to 1.62.1), `playwright-core`, then
`tools/screenshots/node_modules/playwright-core` — so locally it works with no
extra install once `tools/screenshots` has been `npm ci`'d. Useful knobs:
`E2E_HEADED=1` to watch it, `E2E_SHOTS=<dir>` for a screenshot per milestone
plus a `99-failure.png` when something breaks, `SMOKE_TRAEFIK_ORIGIN` (API
script) to probe Traefik on 127.0.0.1 with an explicit `Host:` header instead of
resolving `*.traefik.me`.

`apps/web/e2e/smoke.mjs` is the older, tolerant version of the same idea; the
two `tools/` scripts above are what CI runs.

## Continuous integration

Every pull request and push to `main` runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job | What it proves | Local equivalent |
| --- | --- | --- |
| **Checks** (reusable [`checks.yml`](../.github/workflows/checks.yml)) | `pnpm typecheck`, Biome, `pnpm test:db` with `DATABASE_URL_TEST` on a Postgres 17 service (tenancy suite included), `pnpm -F @nixploy/cli test`, the web tests, Traefik static-config drift | the verify loop above, plus `DATABASE_URL_TEST=…` |
| **Build (web / landing / cli)** | `next build` for the panel and landing, `tsup` for the CLI — the panel builds with no env on purpose, like the Dockerfile | `pnpm -F @nixploy/web build` etc. |
| **Docker image + Trivy** | `docker/Dockerfile` builds (single-arch, not pushed, GHA cache) and a Trivy `CRITICAL,HIGH` scan — advisory (`exit-code: 0`) on PRs; the release scan is `CRITICAL` + `exit-code: 1`. Also exports the image as an artifact for the e2e job | `docker build -f docker/Dockerfile .` |
| **End-to-end (image on a real Swarm)** | The PR's own image + Postgres 17 booted with [`tools/ci/e2e-compose.yml`](../tools/ci/e2e-compose.yml) on the runner's Swarm: migrations from an empty database, `/api/ready`, first admin through the real `/setup` flow, then `tools/golden-path-api.mjs` and `tools/e2e-ui.mjs`. 25-minute cap; panel logs, Swarm task state, the config root and the UI screenshots are uploaded on failure | the three commands in "End-to-end against a running panel" above |
| **ShellCheck** | `install.sh`, `update.sh`, `docker/entrypoint.sh`, `tools/*.sh` at severity `warning` (0 findings today) | `shellcheck --severity=warning install.sh update.sh docker/entrypoint.sh tools/*.sh` |
| **pnpm audit** | `pnpm audit --prod --audit-level high`, **blocking** since 2026-09-11 (the §2.8 advisories are fixed or overridden; three moderate ones remain below the gate) | `pnpm audit --prod --audit-level high` |
| **Template image health**, **Swarm smoke** | Registry manifests for every template image; Traefik → whoami on a real Swarm; `install.sh`'s static config boots Traefik | `pnpm test:template-images` |
| **CodeQL** ([`codeql.yml`](../.github/workflows/codeql.yml)) | JavaScript/TypeScript static analysis on PRs, `main` and weekly | — |

The same `checks.yml` gates [`release.yml`](../.github/workflows/release.yml) on the tagged
ref before an image is built, so PR checks and the release gate cannot drift
([releases.md](./releases.md)). Superseded PR runs are cancelled; pushes to `main` always
finish. [Dependabot](../.github/dependabot.yml) opens weekly PRs for npm (minor/patch
grouped, `better-auth` excluded — bump it by hand), GitHub Actions and the Docker base image.

### Notes on the e2e job

- The panel's config root is bind-mounted from the host at `/etc/nixploy`, **not** a named
  volume. The panel creates the `nixploy-traefik` Swarm service through the mounted docker
  socket, and the bind mounts in that `docker service create` are resolved by the host
  daemon — the path has to mean the same thing on both sides, exactly as `install.sh`
  arranges it.
- The image ships `NIXPLOY_DISABLE_TRAEFIK_BOOT=1` (production hands Traefik to
  `install.sh`); the compose file sets it to an empty string so the panel provisions Traefik
  itself and the golden path really goes through the proxy.
- Traefik publishes `:80` and `:443` in host mode and there is no port knob
  (`modules/traefik/setup.ts` hard-codes them), so the job asserts both ports are free
  before starting and fails with the culprit if a future runner image occupies them.
- Playwright is installed into `$RUNNER_TEMP/pw` and reached through `NODE_PATH`, so the
  workspace's deliberately fixed dependency set is untouched. Equivalent locally:
  `npx --yes playwright@1.62.1 install --with-deps chromium`.

Validate workflow syntax locally with [`act`](https://github.com/nektos/act):
`act -l` lists every job and fails on YAML errors; `act pull_request -W
.github/workflows/ci.yml -j e2e --dryrun` walks a job without running it (plain `act -j`
defaults to a `push` event, whose empty `head_commit` makes the `[skip ci]` guards evaluate
to "skip"). Do not run the Docker/Postgres jobs under `act` — it segfaults on a job with
`services:`.

## Useful debugging handles

- Traefik dynamic configs: `$NIXPLOY_CONFIG_DIR/traefik/dynamic/<appName>.yml`
  (hot-reloaded by the file provider — edit via the app, not by hand).
- App build dirs and logs: `$NIXPLOY_CONFIG_DIR/applications/<appName>/`.
- Database: `pnpm db:studio` for Drizzle Studio.
- REST API: `/swagger` for OpenAPI docs; authenticate with `x-api-key`
  (create keys in Settings → Profile → API keys).

## Docs map

`docs/architecture.md` · `docs/development.md` · `docs/deployment-flow.md` ·
`docs/domains-traefik.md` · `docs/auth.md` · `docs/audit.md` · `docs/docker.md` ·
`docs/observability.md` · `docs/templates.md`

Operator-facing: `docs/install.md` (including the runtime-environment
reference) · `docs/troubleshooting.md` · `docs/upgrade-notes.md` ·
`docs/instance-backup.md` · `docs/releases.md` · [`CHANGELOG.md`](../CHANGELOG.md)

## Local equivalent of the CI checks

```bash
pnpm typecheck && pnpm exec biome check --error-on-warnings packages/server apps/web apps/cli apps/landing && pnpm knip && DATABASE_URL_TEST=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy_test pnpm test:db && pnpm -F @nixploy/cli test && pnpm -F @nixploy/web test
```
