# Install (production)

One Linux host with root (or passwordless sudo). Nixploy installs Docker if
needed, initializes Swarm, and starts three Swarm services: `nixploy`,
`nixploy-postgres`, and `nixploy-traefik`.

## Requirements

- x86_64 or arm64 Linux (Ubuntu/Debian/RHEL-family work best)
- **Root Docker daemon**, Swarm-capable. Rootless Docker is not supported —
  it has no Swarm, cannot bind :80/:443 and cannot share `/var/run/docker.sock`
- Public IP (or a private network + your own TLS terminator)
- Ports **80** and **443** free for Traefik
- ~2 GB RAM minimum (4 GB+ recommended if you deploy many apps, or if you
  let the installer build the image from source)
- **≥ 5 GB free disk** on both the config directory and the Docker root —
  images, build caches, Postgres data and app checkouts all live there

The installer checks all of these before it downloads anything (see
[Preflight](#preflight) below).

## One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

`main` tracks the branch default for `NIXPLOY_VERSION`. For a specific release, use the
**version-pinned** script from [GitHub Releases](https://github.com/bablilayoub/nixploy/releases)
(see [releases.md](./releases.md)):

```bash
curl -fsSL https://github.com/bablilayoub/nixploy/releases/latest/download/install.sh | sudo bash
```

With a real domain (recommended — Let's Encrypt):

1. Point an **A record** for `panel.yourdomain.com` at the server.
2. Run:

```bash
NIXPLOY_DOMAIN=panel.yourdomain.com \
NIXPLOY_LETSENCRYPT_EMAIL=you@yourdomain.com \
  curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

When it finishes, open the printed **Setup** URL and create the owner account.
Public `/register` is disabled after that.

### Verify the installer before running it

The one-liner pipes a script straight into root's shell. Every release ships a
`SHA256SUMS` file, so the safer form is download → verify → run:

```bash
VERSION=v0.2.0   # the release you want
BASE="https://github.com/bablilayoub/nixploy/releases/download/$VERSION"
curl -fsSLO "$BASE/install.sh"
curl -fsSLO "$BASE/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS    # → install.sh: OK
sudo bash install.sh
```

On macOS use `shasum -a 256 --ignore-missing -c SHA256SUMS`. The same file covers
`update.sh` and `uninstall.sh`.

The checksums only match the **release assets**, not the `raw.githubusercontent.com/.../main/`
copies — release assets carry a `NIXPLOY_VERSION` line pinned to that tag, which the branch
copies do not. If you install from `main`, there is nothing to verify against; prefer a
tagged release.

The panel image is signed with cosign (keyless, GitHub OIDC). To verify a tag:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github\.com/bablilayoub/nixploy/\.github/workflows/(release|docker)\.yml@refs/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/bablilayoub/nixploy:v0.2.0
```

## Preflight

Right after Docker is available and **before** any image is pulled, the
installer checks the host and tells you what is wrong in one line instead of
failing minutes later inside `docker service create`:

| Check | Behaviour | Escape hatch |
| --- | --- | --- |
| Rootless Docker (`docker info` → `SecurityOptions`) | **fails** — there is no workaround | — |
| Ports 80 / 443 free (`ss`, then `lsof`, then `netstat`) | **fails** with the conflicting port. Skipped when `nixploy-traefik` already owns them (every re-run), and when none of the three tools exists | `NIXPLOY_SKIP_PORT_CHECK=1` |
| ≥ 5 GB free on the config dir and the Docker root | warns | — |
| ≥ 2 GB RAM (`/proc/meminfo`) | warns | — |
| `NIXPLOY_DOMAIN`'s A record vs this host's public IP | warns on a mismatch or when it does not resolve — a wrong record burns Let's Encrypt failures (5 per hostname per hour) and leaves you on the self-signed certificate. Expected behind a proxy/CDN | `NIXPLOY_SKIP_DNS_CHECK=1` |

The summary at the end prints the firewall one-liner for whichever firewall
this host runs:

```bash
ufw allow 80,443/tcp
# or
firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload
```

On a cloud host, open 80/443 in the provider's security group too — the
installer cannot see that.

## What the installer does

1. Detects the OS and installs Docker (unless `NIXPLOY_SKIP_DOCKER_INSTALL=1`)
2. Runs the [preflight](#preflight) checks above
3. `docker swarm init` (single-node manager)
4. Creates the two platform overlays: `nixploy-network` (shared, Traefik-facing
   — only tenant services that have a domain join it) and `nixploy-internal`
   (panel ↔ Postgres, no tenant workload ever). See [hardening](./hardening.md)
5. Detects the public IP (`api.ipify.org`, falling back to the primary
   interface — NAT'd clouds put a private address on the NIC) and writes
   secrets under `/etc/nixploy/.env` (or `$NIXPLOY_CONFIG_DIR`)
6. Starts `nixploy` + Postgres + Traefik from GHCR (builds from source if the
   image pull fails), then waits for the panel **through Traefik on
   loopback** (`GET /api/ready`) — public DNS does not have to be propagated
   yet. The `nixploy` service gets a 90 s stop grace period, a memory limit
   (`NIXPLOY_MEMORY_LIMIT`, default `2g`, `512m` reserved) and rotated JSON
   logs; `nixploy-postgres` gets a `pg_isready` healthcheck, the same log
   rotation and a 60 s stop grace period so a checkpoint can finish.
   `nixploy` and `nixploy-postgres` are attached to `nixploy-internal` only;
   `nixploy-traefik` is on both overlays
7. With `--split-worker`, also creates `nixploy-worker` (same image, same
   `.env`, same config volume and docker socket, `nixploy-internal` only) and
   sets `NIXPLOY_ROLE=panel` on `nixploy` — see [Split worker](#split-worker)

The script is **idempotent** — safe to re-run. A re-run keeps the existing
secrets, `BETTER_AUTH_URL`, the dashboard router (`00-nixploy-dashboard.yml`)
and the ACME email, and derives the dashboard domain from the stored
`BETTER_AUTH_URL`. Only an explicit `NIXPLOY_DOMAIN`, `NIXPLOY_PUBLIC_IP` or
`NIXPLOY_LETSENCRYPT_EMAIL` changes those.

**Let's Encrypt needs a contact email.** Without `NIXPLOY_LETSENCRYPT_EMAIL`
(or a domain, from which `admin@<domain>` is guessed) the static Traefik config
carries the placeholder `nixploy@localhost`, which Let's Encrypt rejects: the
panel stays on the self-signed certificate and app domains cannot get real
certificates until you set the email — re-run with the variable, or use
**Settings → Platform → Let's Encrypt email**. The installer prints a warning
in that case.

The panel is only reachable through Traefik. Port `3000` is **not**
host-published unless you set `NIXPLOY_PORT` (plain HTTP, all interfaces —
Swarm host-mode publishing cannot bind to `127.0.0.1` only).

**No global HTTP → HTTPS redirect.** Since v0.2.0 the static Traefik config
has no entrypoint-level redirection: it would override every domain's own
`https` toggle. Instead the panel writes a per-router `redirectScheme`
middleware for each domain that has HTTPS on, so a domain with HTTPS **off**
is served plain on `:80` — which is the point of the toggle. The dashboard
router itself is `websecure`-only, so the panel is still HTTPS. `update.sh`
removes the old redirect block from existing installs and restarts the proxy.

## After install (first hour)

1. **Setup** — create owner + org
2. **Settings → Platform → Access** — confirm dashboard domain / Let's Encrypt email
3. **Templates** or **New application** — deploy `traefik/whoami` or a template
4. **Domains** — add a host (custom DNS or `*.traefik.me` for local smoke)
5. **Settings → Profile** — create an API key for the CLI

```bash
npm i -g @nixploy/cli
nixploy auth login --url https://panel.yourdomain.com --api-key nxp_...
nixploy doctor
```

## Installer options

Install-time knobs. They shape what the installer *does*; they are not part of
the panel's runtime environment (that is the next section).

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIXPLOY_DOMAIN` | — | Panel hostname (A record must point here) |
| `NIXPLOY_LETSENCRYPT_EMAIL` | `nixploy@localhost` sentinel | ACME contact — **required** for Let's Encrypt (see above) |
| `NIXPLOY_PUBLIC_IP` | `api.ipify.org`, then the primary interface | Public IPv4 for `BETTER_AUTH_URL`, the setup URL and the self-signed SAN. Setting it also skips the ipify call (offline installs) |
| `NIXPLOY_VERSION` | the release tag | App image tag |
| `NIXPLOY_IMAGE` | `ghcr.io/bablilayoub/nixploy:$NIXPLOY_VERSION` | Full image ref (overrides the tag). Also passed to the panel as `NIXPLOY_IMAGE` so Settings → Updates tracks it |
| `NIXPLOY_PORT` | unset | Additionally host-publish the panel on this port (plain HTTP, all interfaces — Swarm host-mode cannot bind loopback only) |
| `NIXPLOY_CONFIG_DIR` | `/etc/nixploy` | Host data dir. Inside the container it is always `/etc/nixploy` |
| `NIXPLOY_MEMORY_LIMIT` | `2g` | Memory limit of the `nixploy` service (`512m` reserved). Raise on hosts that build large images in the panel |
| `NIXPLOY_SPLIT_WORKER` | `0` | `1` (or `--split-worker`) also creates `nixploy-worker` — see [Split worker](#split-worker) |
| `NIXPLOY_WORKER_MEMORY` | `2g` | Memory limit of the `nixploy-worker` service (`512m` reserved), when it exists |
| `POSTGRES_VERSION` | `17-alpine` | Postgres image tag |
| `TRAEFIK_VERSION` | `v3.5.0` | Traefik image tag |
| `NIXPLOY_SKIP_PORT_CHECK` | `0` | Do not refuse to install when :80/:443 are taken |
| `NIXPLOY_SKIP_DNS_CHECK` | `0` | Do not compare `NIXPLOY_DOMAIN`'s A record with the public IP |
| `NIXPLOY_SKIP_DOCKER_INSTALL` | `0` | Require a pre-installed Docker (skip `get.docker.com`) |
| `NIXPLOY_BUILD_FROM_SOURCE` | `0` | Always build the image locally instead of pulling |
| `NIXPLOY_REPO` / `NIXPLOY_BRANCH` | `bablilayoub/nixploy` / the image tag | Source for local builds |
| `NIXPLOY_GITHUB_TOKEN` | — | Fine-grained PAT (Contents: Read) for a private repo. `GITHUB_TOKEN` also works. Needed under `sudo`, which does not see your user gitconfig |
| `NIXPLOY_RENDER_TRAEFIK_ONLY` | `0` | Print the static `traefik.yml` the script writes and exit (CI drift check — no root, no Docker) |

## Split worker

By default Nixploy is **one process**: the UI, the API, the websockets, the
deploy queue and every cron share a single Node process and a single memory
limit. That is the right shape for most installs, and it stays the default.

`--split-worker` moves the background half into its own Swarm service:

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh \
  | sudo bash -s -- --split-worker

# equivalently, for the piped one-liner:
NIXPLOY_SPLIT_WORKER=1 curl -fsSL …/install.sh | sudo bash
```

| | `nixploy` (`NIXPLOY_ROLE=panel`) | `nixploy-worker` (`NIXPLOY_ROLE=worker`) |
| --- | --- | --- |
| Serves | UI, tRPC, REST, MCP, `/ws/*`, webhooks | `/api/health`, `/api/ready`, `/api/version` on `:3001` |
| Runs | enqueues deploys, writes per-domain Traefik YAML | the deploy claim loop, boot recovery, every cron, the Traefik bootstrap |
| Memory | `NIXPLOY_MEMORY_LIMIT` (default `2g`) | `NIXPLOY_WORKER_MEMORY` (default `2g`) |
| Networks | `nixploy-internal` | `nixploy-internal` |
| Mounts | `/var/run/docker.sock`, the config dir | `/var/run/docker.sock`, the config dir |
| Migrations | skipped (503 on `/api/ready` until the schema matches) | runs them |

Why you might want it:

- **Updating the panel stops interrupting builds.** A `panel` restart closes
  websockets and exits in milliseconds; the worker keeps building.
- **Separate memory ceilings.** A build that eats 2 GB can no longer OOM the UI,
  and you can give the worker more than the panel (or the reverse).
- **Smaller blast radius.** A crash in a cron takes the worker, not the panel.

What it costs: a second container, and `docker service logs -f nixploy-worker`
is where deploy and cron output now lives. The two halves coordinate over
Postgres `LISTEN/NOTIFY` — no broker, no extra port, no schema change (see
[deployment-flow.md](./deployment-flow.md) → "Process roles and the worker
service").

`update.sh` rolls **both** services when the worker exists (worker first — it
owns the migrations), `uninstall.sh` removes both, and re-running `install.sh`
keeps the split without repeating the flag. To collapse back to one process:

```bash
sudo bash install.sh --no-split-worker
```

The panel is set back to `NIXPLOY_ROLE=all` before the worker service is
removed, so nothing is ever unowned in between.

## Runtime environment

**This table is the operator reference.** Every variable the panel process
reads is listed here. Set any of them in the environment of `install.sh` or
`update.sh` and the script adds it to the `nixploy` service spec, so it
survives later updates:

```bash
LOG_FORMAT=json TZ=Europe/Paris NIXPLOY_DEPLOY_CONCURRENCY=4 \
  curl -fsSL …/update.sh | sudo bash
```

`--env-add` never removes anything, so a variable you set once stays until
you remove it by hand (`docker service update --env-rm NAME nixploy`).

### Written by the installer (do not hand-edit)

Stored in `<config>/.env` (mode 600) and put on the service at create time.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string of the platform database |
| `BETTER_AUTH_SECRET` | Session signing secret. Changing it invalidates every session |
| `BETTER_AUTH_URL` | Public origin of the panel. **Must** match the URL you browse to, or sign-in fails with "Invalid origin" |
| `ENCRYPTION_KEY` | AES-256-GCM key for secrets at rest. **Changing it makes every stored env var, password, token and S3 key unreadable** — back it up (see [instance-backup.md](./instance-backup.md)) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Passed to `nixploy-postgres` only, never to the panel |
| `PORT` | `3000`, the port the panel listens on inside the container |
| `NIXPLOY_CONFIG_DIR` | Always `/etc/nixploy` on the service (the host path is the bind-mount source) |
| `NIXPLOY_DISABLE_TRAEFIK_BOOT` | `1` in production — `install.sh` owns the proxy, so the panel must not bootstrap it |
| `NIXPLOY_IMAGE` | The image ref this install tracks (Settings → Updates) |

### Forwarded when you set them

| Variable | Default | What it does |
| --- | --- | --- |
| `NIXPLOY_ROLE` | `all` | `all` \| `panel` \| `worker` — what this process owns (see [Split worker](#split-worker)). Set by the installer; do not set it by hand on a single-process install |
| `TRUSTED_PROXIES` | `1` (set by the installer) | Trust `X-Forwarded-For` for client IPs. Without it every client IP is "unknown" and IP-based rate limits degrade to one shared bucket |
| `TZ` | UTC | Process timezone. **Every cron runs in it** — backups, schedules, update checks, platform alerts. The image ships `tzdata`, so real zone names work |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_FORMAT` | plain text | `json` for one JSON object per line — see [observability.md](./observability.md#platform-logs) |
| `DATABASE_POOL_MAX` | `10` | Postgres pool size in the panel process. Raise on busy installs (web + deploy worker + crons share it) |
| `LISTEN_HOST` | `0.0.0.0` | Bind address of the custom server |
| `NIXPLOY_BASE_URL` | — | Public origin used for the GitHub App callback when `BETTER_AUTH_URL` is not the right one |
| `NIXPLOY_NETWORK` | `nixploy-network` | Shared, Traefik-facing tenant overlay. The panel/Postgres overlay is always `nixploy-internal` |
| `NIXPLOY_WILDCARD_DOMAIN` | `traefik.me` | Wildcard DNS zone used for preview deployments and quick smoke domains |
| `NIXPLOY_DEPLOY_CONCURRENCY` | `2` | Deploy jobs built in parallel. The queue is **process-local** — multi-replica `nixploy` is unsupported by design |
| `NIXPLOY_DEPLOY_TIMEOUT_MS` | 60 min | Per-deployment deadline |
| `NIXPLOY_COMMAND_TIMEOUT_MS` | 30 min | Default timeout for local shell/Docker commands |
| `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS` | falls back to the local timeout | Same, for commands run over SSH on a managed server |
| `NIXPLOY_SHUTDOWN_GRACE_MS` | 60 s | How long SIGTERM waits for running deployments before cancelling them. Keep it below the service's 90 s stop grace |
| `NIXPLOY_DB_WAIT_SECONDS` | `60` | How long the entrypoint waits for Postgres before migrating (host reboots start both tasks at once) |
| `NIXPLOY_CRON_CATCH_UP` | `0` | `1` replays every overdue cron **once** at boot. Off by default — a nightly dump that missed its window is often better skipped |
| `NIXPLOY_AUDIT_RETENTION_DAYS` | `365` | `audit_log` retention. `0` keeps rows forever |
| `NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS` | `8` | Alert when no instance backup succeeded in this many days. `0` disables it |
| `NIXPLOY_DOCKER_CLEANUP_CRON` | unset (off) | Cron expression for the weekly prune of dangling images + BuildKit cache |
| `NIXPLOY_SCHEDULES_LOG_PATH` | `<config>/schedules` | Where schedule run output is written |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket the panel talks to |
| `NIXPLOY_MIGRATIONS_DIR` | `/app/packages/server/drizzle` (image) | Migration journal directory. Set by the image; only relevant for custom layouts |
| `NIXPLOY_APP_VERSION` | baked at build time | Version Settings → Updates reports |
| `NIXPLOY_GIT_COMMIT` | baked at build time | Git SHA in `GET /api/version` |
| `NIXPLOY_DIR` | — | Legacy alias for `NIXPLOY_CONFIG_DIR`. Do not use in new installs |

`DATABASE_URL_TEST` is a development-only variable (the tenancy suite skips
without it) and is never set in production.

Container logs use the `json-file` driver with rotation (`max-size=10m`,
`max-file=3`) for all three services.

See the header comments in [`install.sh`](../install.sh). This file is the
source of truth for installer/updater env knobs; README and the landing
`/install` page link here instead of duplicating tables.

## Offline / air-gapped install

The installer reaches out to `get.docker.com` (Docker), `api.ipify.org`
(public IP) and GHCR (images). All three are skippable.

On a machine **with** network access, pull and export the images:

```bash
docker pull ghcr.io/bablilayoub/nixploy:v0.2.0
docker pull postgres:17-alpine
docker pull traefik:v3.5.0
docker save ghcr.io/bablilayoub/nixploy:v0.2.0 postgres:17-alpine traefik:v3.5.0 \
  | gzip > nixploy-images.tar.gz
```

Copy `nixploy-images.tar.gz` and `install.sh` to the target host, then:

```bash
# 1. Docker must already be installed (the convenience script is skipped).
docker load < nixploy-images.tar.gz

# 2. Install without any outbound call.
NIXPLOY_SKIP_DOCKER_INSTALL=1 \
NIXPLOY_PUBLIC_IP=10.0.0.5 \
NIXPLOY_IMAGE=ghcr.io/bablilayoub/nixploy:v0.2.0 \
NIXPLOY_SKIP_DNS_CHECK=1 \
  sudo -E bash install.sh
```

- `NIXPLOY_SKIP_DOCKER_INSTALL=1` — never call `get.docker.com`; the script
  fails fast if Docker is missing.
- `NIXPLOY_PUBLIC_IP=…` — skips the `api.ipify.org` lookup entirely.
- `NIXPLOY_IMAGE=…` — point at whatever tag you loaded, or at an internal
  mirror (`registry.internal/nixploy:v0.2.0`). `docker pull` still runs, but
  a locally loaded image satisfies it; with a mirror, log in first
  (`docker login registry.internal`).
- `POSTGRES_VERSION` / `TRAEFIK_VERSION` must match the tags you loaded.
- Let's Encrypt cannot work air-gapped: the panel keeps the self-signed
  certificate, or upload your own under **Settings → Certificates**.

Updates work the same way — `docker load` the new image, then
`NIXPLOY_IMAGE=… sudo -E bash update.sh`.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/uninstall.sh | sudo bash
```

It prints exactly what it will do and asks before touching anything.

- **Default:** removes the platform services (`nixploy`, `nixploy-worker` when
  a split install created it, `nixploy-postgres`, `nixploy-traefik`) and the
  two platform overlays. The Postgres volume (`nixploy-postgres-data`) and the
  config directory are **kept**, so re-running `install.sh` on the same host
  brings the instance back as it was.
- `--purge`: also deletes the volume and the config directory (secrets,
  Let's Encrypt certificates, SSH keys). Irreversible, needs an interactive
  terminal and the typed phrase `delete nixploy data`.
- `--tenants`: also removes the tenant services on `nixploy-network`. Without
  it your deployed apps keep running.
- Docker, the Swarm cluster and the pulled images are left alone —
  `docker system prune -a` and `docker swarm leave --force` finish the job.

`NIXPLOY_YES=1` skips the y/N prompt for the non-purge path (`--purge` always
asks).


## Update

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash
```

Or from the latest GitHub Release asset (pinned `NIXPLOY_VERSION`):

```bash
curl -fsSL https://github.com/bablilayoub/nixploy/releases/latest/download/update.sh | sudo bash
```

Keeps secrets, Postgres data, ACME certs, and Traefik routes. Migrations run on
boot. Or use **Settings → Platform → Updates** in the UI.

On a [split install](#split-worker) both services are rolled: `nixploy-worker`
first, because it is the half that runs the migrations, then `nixploy` — whose
`/api/ready` keeps it out of the service VIP until the schema matches.

The roll is `stop-first` with `--update-failure-action rollback`: the image's
`HEALTHCHECK` (`GET /api/ready`, see [observability.md](./observability.md#platform-health-endpoints))
gates readiness — it answers 503 while Postgres, the Docker socket or the
migration state is broken — and a new container that dies within the 60 s
monitor window makes Swarm restore the previous version automatically;
`update.sh` reports this as a failed update. Readiness is probed through
Traefik on loopback (`https://<host>/api/ready`, with a `/setup` fallback for
images that predate the endpoint), so `:3000` does not need to be published.
The service has a 90 s stop grace period so an in-flight deploy can finish
or be marked as interrupted cleanly. To roll back by hand:
`docker service rollback nixploy`.

### Upgrade safety

Swarm's rollback restores the previous **image**, not the previous
**database**: a migration that partially applied stays applied. Both update
paths therefore dump the platform database right before the roll:

- `update.sh` runs `pg_dump --clean --if-exists` inside `nixploy-postgres`
  into `<config>/backups/pre-update-<tag>-<timestamp>.sql.gz` (mode `600`,
  the newest 3 are kept) and prints the restore command. A failed or empty
  dump aborts the update; `NIXPLOY_PRE_UPDATE_BACKUP=0` skips it.
- The in-app updater (Settings → Updates) does the same through the Docker
  socket. When no `nixploy-postgres` container is on the node (development
  against a plain Postgres) it logs a warning and continues.
- The in-app updater also refuses to roll while deployments are running — the
  restart would interrupt them — and asks for confirmation ("Update anyway")
  first. Automatic updates never force; they retry on the next check.

Restore a dump (stops nothing; run it before pinning an older tag):

```bash
gunzip -c /etc/nixploy/backups/pre-update-v0.2.0-20260910T120000Z.sql.gz \
  | docker exec -i "$(docker ps -q -f label=com.docker.swarm.service.name=nixploy-postgres)" \
      psql -q -U nixploy -d nixploy
```

### Downgrade

Migrations are forward-only, so `update.sh` refuses to roll to a **lower**
semver tag (`NIXPLOY_VERSION=v0.1.0` while `v0.2.0` runs). To go back:

1. Restore the pre-update dump that was taken **before** the version you are
   leaving was installed (command above).
2. Re-run with the old tag and the guard disabled:
   `NIXPLOY_VERSION=v0.1.0 NIXPLOY_ALLOW_DOWNGRADE=1 … update.sh`.

`/api/ready` reports `migrations.state: "ahead"` (a warning, not a failure)
while old code runs on a newer schema. Non-semver tags (`latest`, digests)
skip the guard.

### Update overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIXPLOY_VERSION` / `NIXPLOY_IMAGE` | release default / `v0.1.0` in repo | Pin app image tag or full ref |
| `NIXPLOY_CONFIG_DIR` | `/etc/nixploy` | Host config/data directory |
| `NIXPLOY_PORT` | auto-detected from the service | Host port `:3000` is published on (extra readiness probe only) |
| `NIXPLOY_LETSENCRYPT_EMAIL` | keep existing | Replace the ACME email in `traefik.yml` |
| every knob in [Runtime environment](#runtime-environment) | — | Forwarded to the panel when set in this script's environment |
| `NIXPLOY_UPDATE_TRAEFIK` | `1` | Also pull & force Traefik service |
| `NIXPLOY_UPDATE_POSTGRES_SPEC` | `0` | Apply the `pg_isready` healthcheck, rotated json-file logs and the 60 s stop grace to an older `nixploy-postgres` service. **Restarts Postgres once**, so it is opt-in; idempotent |
| `NIXPLOY_REFRESH_TRAEFIK_YML` | `1` | Re-render static `traefik.yml` locally (same content as the app writes), keeping the ACME email |
| `NIXPLOY_PRUNE` | `1` | Prune dangling images after roll |
| `NIXPLOY_PRE_UPDATE_BACKUP` | `1` | `pg_dump` the platform DB to `<config>/backups` before rolling (keeps 3) |
| `NIXPLOY_ALLOW_DOWNGRADE` | `0` | Allow rolling to a lower semver tag (restore a dump first — see above) |
| `NIXPLOY_MEMORY_LIMIT` | `2g` | Memory limit of the `nixploy` service (`512m` reserved) |
| `NIXPLOY_BUILD_FROM_SOURCE` | `0` | Build locally instead of pulling GHCR |
| `NIXPLOY_REPO` / `NIXPLOY_BRANCH` | `bablilayoub/nixploy` / image tag | Source for local builds |

See the header comments in [`update.sh`](../update.sh).

## Troubleshooting

Symptom-keyed runbook: **[troubleshooting.md](./troubleshooting.md)**. The
short version:

| Symptom | Check |
| --- | --- |
| Can't reach panel | `docker service ls`, `docker service logs nixploy`, firewall 80/443 |
| Setup URL shows a private IP / "Invalid origin" on sign-in | `BETTER_AUTH_URL` in `/etc/nixploy/.env` must be the address you browse to: re-run with `NIXPLOY_PUBLIC_IP=…` or `NIXPLOY_DOMAIN=…` |
| Update rolled back | `docker service ps nixploy --no-trunc` shows the failed task; `docker service logs nixploy` has the boot/migration error; restore the pre-update dump if a migration half-applied (see Upgrade safety) |
| Panel unhealthy / restart loop | `curl -s https://<host>/api/ready` lists the failing check (Postgres, docker socket, migrations); `nixploy doctor` prints the same plus versions |
| Panel boots before Postgres after a reboot | Expected: the entrypoint waits up to 60 s (`NIXPLOY_DB_WAIT_SECONDS`) and the migrator retries connection errors before giving up |
| TLS stuck | DNS A record, Let's Encrypt email (not `nixploy@localhost`), Traefik logs |
| Deploy never finishes | Application → Deployments → Logs; Docker disk space |
| Traefik not routing | Domain attached? Service status `done`? `docker service inspect <appName> --format '{{json .Spec.TaskTemplate.Networks}}'` — a service only joins `nixploy-network` while it has a domain |
| App can't reach another service by name | They must be in the **same environment**: each environment has its own overlay (`<env>-<id8>-net`). Cross-environment and cross-organisation DNS is intentionally gone |
| Panel can't reach Postgres after an upgrade | `docker service inspect nixploy --format '{{json .Spec.TaskTemplate.Networks}}'` must list `nixploy-internal`; re-run `update.sh` (the migration is idempotent) |
| A domain with HTTPS off still redirects to https | An install from before v0.2.0 still has the entrypoint redirect in `traefik.yml`. Re-run `update.sh` (it re-renders the file and restarts the proxy), or delete the `http.redirections` block by hand and `docker service update --force nixploy-traefik` |

## Network segmentation migration (upgrading an older install)

Installs made before tenant network segmentation had `nixploy` and
`nixploy-postgres` on the shared tenant overlay, where any application
container could resolve `nixploy:3000` and `nixploy-postgres:5432`. Both
`install.sh` and `update.sh` now run an **idempotent** migration
(`migrate_internal_network`) before rolling the services:

1. create `nixploy-internal` if missing;
2. `docker service update --network-add nixploy-internal nixploy-traefik`
   (so Traefik can still reach the panel);
3. same for `nixploy-postgres`, then `--network-rm nixploy-network`;
4. same for `nixploy`, then `--network-rm nixploy-network`.

Each step is skipped when already done, and a service is never detached from
the tenant overlay before it is attached to the internal one. Every
`--network-add` / `--network-rm` recreates that service's tasks, so expect a
short panel restart on the first upgrade. `DATABASE_URL` is unchanged —
`nixploy-postgres` resolves on the new network exactly as before.

Verify afterwards:

```bash
docker network inspect nixploy-internal --format '{{range .Services}}{{.Name}} {{end}}'
# nixploy nixploy-postgres nixploy-traefik

docker service inspect nixploy --format '{{json .Spec.TaskTemplate.Networks}}'
# exactly one target: the nixploy-internal id
```

More: [architecture](./architecture.md), [domains](./domains-traefik.md),
[hardening](./hardening.md), [deployment flow](./deployment-flow.md).
