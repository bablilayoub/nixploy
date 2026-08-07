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
3. Creates the `nixploy-network` overlay
4. Writes secrets under `/etc/nixploy/.env` (or `$NIXPLOY_CONFIG_DIR`)
5. Starts `nixploy` + Postgres + Traefik from GHCR (builds from source if the
   image pull fails)

The script is **idempotent** — safe to re-run.

## After install (first hour)

1. **Setup** — create owner + org
2. **Settings → Platform** — confirm dashboard domain / Let's Encrypt email
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
| `NIXPLOY_LETSENCRYPT_EMAIL` | ACME contact |
| `NIXPLOY_VERSION` / `NIXPLOY_IMAGE` | Pin image tag or full ref |
| `NIXPLOY_PORT` | Host publish port if not 80/443 only |
| `NIXPLOY_CONFIG_DIR` | Data dir (default `/etc/nixploy`) |
| `NIXPLOY_BUILD_FROM_SOURCE=1` | Force local image build |
| `NIXPLOY_SKIP_DOCKER_INSTALL=1` | Assume Docker is already present |
| `DATABASE_POOL_MAX` | Postgres pool size in the Nixploy process (default `10`). Raise on busy single-node installs that share web + deploy worker + crons. |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default `info`) for the process logger |
| `LOG_FORMAT` | Set to `json` for one JSON object per log line (default: plain text with `[subsystem]` prefix) |

See the header comments in [`install.sh`](../install.sh). This file is the
source of truth for installer/updater env knobs; README and the landing
`/install` page link here instead of duplicating tables.

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/update.sh | sudo bash
```

Keeps secrets, Postgres data, ACME certs, and Traefik routes. Migrations run on
boot. Or use **Settings → Platform → Updates** in the UI.

### Update overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIXPLOY_VERSION` / `NIXPLOY_IMAGE` | `latest` | Pin app image tag or full ref |
| `NIXPLOY_CONFIG_DIR` | `/etc/nixploy` | Host config/data directory |
| `NIXPLOY_PORT` | `3000` | Published app port for health checks |
| `NIXPLOY_UPDATE_TRAEFIK` | `1` | Also pull & force Traefik service |
| `NIXPLOY_REFRESH_TRAEFIK_YML` | `1` | Rewrite static `traefik.yml` from repo |
| `NIXPLOY_PRUNE` | `1` | Prune dangling images after roll |
| `NIXPLOY_BUILD_FROM_SOURCE` | `0` | Build locally instead of pulling GHCR |
| `NIXPLOY_REPO` / `NIXPLOY_BRANCH` | `bablilayoub/nixploy` / `main` | Source for Traefik assets / build |

See the header comments in [`update.sh`](../update.sh).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Can't reach panel | `docker service ls`, `docker service logs nixploy`, firewall 80/443 |
| TLS stuck | DNS A record, Let's Encrypt email, Traefik logs |
| Deploy never finishes | Application → Deployments → Logs; Docker disk space |
| Traefik not routing | Domain attached? Service status `done`? `nixploy-network` connected? |

More: [architecture](./architecture.md), [domains](./domains-traefik.md),
[deployment flow](./deployment-flow.md).
