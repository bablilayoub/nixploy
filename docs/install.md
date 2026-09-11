# Install (production)

One Linux host with root (or passwordless sudo). Nixploy installs Docker if
needed, initializes Swarm, and starts three Swarm services: `nixploy`,
`nixploy-postgres`, and `nixploy-traefik`.

## Requirements

- x86_64 or arm64 Linux (Ubuntu/Debian/RHEL-family work best)
- Public IP (or a private network + your own TLS terminator)
- Ports **80** and **443** free for Traefik
- ~2 GB RAM minimum (4 GB+ recommended if you deploy many apps)

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

## What the installer does

1. Detects the OS and installs Docker (unless `NIXPLOY_SKIP_DOCKER_INSTALL=1`)
2. `docker swarm init` (single-node manager)
3. Creates the two platform overlays: `nixploy-network` (shared, Traefik-facing
   — only tenant services that have a domain join it) and `nixploy-internal`
   (panel ↔ Postgres, no tenant workload ever). See [hardening](./hardening.md)
4. Detects the public IP (`api.ipify.org`, falling back to the primary
   interface — NAT'd clouds put a private address on the NIC) and writes
   secrets under `/etc/nixploy/.env` (or `$NIXPLOY_CONFIG_DIR`)
5. Starts `nixploy` + Postgres + Traefik from GHCR (builds from source if the
   image pull fails), then waits for the panel **through Traefik on
   loopback** (`GET /api/ready`) — public DNS does not have to be propagated
   yet. The `nixploy` service gets a 90 s stop grace period, a memory limit
   (`NIXPLOY_MEMORY_LIMIT`, default `2g`, `512m` reserved) and rotated JSON
   logs; `nixploy-postgres` gets a `pg_isready` healthcheck, the same log
   rotation and a 60 s stop grace period so a checkpoint can finish.
   `nixploy` and `nixploy-postgres` are attached to `nixploy-internal` only;
   `nixploy-traefik` is on both overlays

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

The panel is only reachable through Traefik (`:80` → `:443`). Port `3000` is
**not** host-published unless you set `NIXPLOY_PORT` (plain HTTP, all
interfaces — Swarm host-mode publishing cannot bind to `127.0.0.1` only).

## After install (first hour)

1. **Setup** — create owner + org
2. **Settings → Platform → Access** — confirm dashboard domain / Let's Encrypt email
3. **Templates** or **New application** — deploy `traefik/whoami` or a template
4. **Domains** — add a host (custom DNS or `*.traefik.me` for local smoke)
5. **Settings → Profile** — create an API key for the CLI

```bash
npm i -g @nixploy/cli
nixploy auth login --url https://panel.yourdomain.com --api-key nxlp_...
nixploy doctor
```

## Useful overrides

| Variable | Purpose |
| --- | --- |
| `NIXPLOY_DOMAIN` | Panel hostname |
| `NIXPLOY_LETSENCRYPT_EMAIL` | ACME contact (required for Let's Encrypt — see above) |
| `NIXPLOY_PUBLIC_IP` | Public IPv4 for `BETTER_AUTH_URL`, the setup URL and the self-signed SAN when auto-detection is wrong (default: `api.ipify.org`, then the primary interface) |
| `NIXPLOY_VERSION` / `NIXPLOY_IMAGE` | Pin image tag or full ref. The ref is also passed to the panel as `NIXPLOY_IMAGE` |
| `NIXPLOY_PORT` | Opt-in: additionally host-publish the app on this port (plain HTTP). Unset = Traefik only |
| `NIXPLOY_CONFIG_DIR` | Host data dir (default `/etc/nixploy`). Inside the container it is always `/etc/nixploy` |
| `NIXPLOY_NETWORK` | Shared tenant overlay (default `nixploy-network`); forwarded to the panel when set. The panel/Postgres overlay is always `nixploy-internal` |
| `TRUSTED_PROXIES` | Forwarded to the panel; defaults to `1` because only Traefik reaches it (client IPs for rate limits come from `X-Forwarded-For`) |
| `NIXPLOY_BUILD_FROM_SOURCE=1` | Force local image build |
| `NIXPLOY_SKIP_DOCKER_INSTALL=1` | Assume Docker is already present |
| `DATABASE_POOL_MAX` | Postgres pool size in the Nixploy process (default `10`). Raise on busy single-node installs that share web + deploy worker + crons. Forwarded when set |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default `info`) for the process logger. Forwarded when set |
| `LOG_FORMAT` | Set to `json` for one JSON object per log line (default: plain text with `[subsystem]` prefix). Forwarded when set |
| `NIXPLOY_MEMORY_LIMIT` | Memory limit of the `nixploy` Swarm service (default `2g`, with a `512m` reservation). Raise on hosts that build large images inside the panel |

Forwarded variables become part of the `nixploy` service spec, so they
survive later `update.sh` runs; `update.sh` only adds/overwrites the ones set
in its own environment. Container logs use the `json-file` driver with
rotation (`max-size=10m`, `max-file=3`) for `nixploy` and `nixploy-traefik`.

See the header comments in [`install.sh`](../install.sh). This file is the
source of truth for installer/updater env knobs; README and the landing
`/install` page link here instead of duplicating tables.

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
| `TRUSTED_PROXIES`, `LOG_LEVEL`, `LOG_FORMAT`, `DATABASE_POOL_MAX`, `NIXPLOY_NETWORK` | — | Forwarded to the panel when set (see install overrides) |
| `NIXPLOY_UPDATE_TRAEFIK` | `1` | Also pull & force Traefik service |
| `NIXPLOY_REFRESH_TRAEFIK_YML` | `1` | Re-render static `traefik.yml` locally (same content as the app writes), keeping the ACME email |
| `NIXPLOY_PRUNE` | `1` | Prune dangling images after roll |
| `NIXPLOY_PRE_UPDATE_BACKUP` | `1` | `pg_dump` the platform DB to `<config>/backups` before rolling (keeps 3) |
| `NIXPLOY_ALLOW_DOWNGRADE` | `0` | Allow rolling to a lower semver tag (restore a dump first — see above) |
| `NIXPLOY_MEMORY_LIMIT` | `2g` | Memory limit of the `nixploy` service (`512m` reserved) |
| `NIXPLOY_BUILD_FROM_SOURCE` | `0` | Build locally instead of pulling GHCR |
| `NIXPLOY_REPO` / `NIXPLOY_BRANCH` | `bablilayoub/nixploy` / image tag | Source for local builds |

See the header comments in [`update.sh`](../update.sh).

## Troubleshooting

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
