# Nixploy

A free, self-hostable Platform as a Service (PaaS) that simplifies the deployment and management of applications and databases — a faithful functional replica of [Dokploy](https://github.com/dokploy/dokploy).

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22-green)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange)
![Docker](https://img.shields.io/badge/docker-swarm-blue)

## Features

- **Applications** — deploy apps from 7 source types (generic Git, GitHub, GitLab, Bitbucket, Gitea, Docker image, drag-and-drop `.zip`) with 6 build types: Nixpacks, Railpack, Dockerfile, Heroku buildpacks, Paketo buildpacks, and static (nginx).
- **Docker Compose** — native `docker compose` / `docker stack` support with a raw editor, `.env` management, per-service domains and logs.
- **Databases** — one-click PostgreSQL, MySQL, MariaDB, MongoDB and Redis, with external ports, connection URLs and scheduled backups to any S3-compatible destination.
- **Domains & TLS** — per-service domains routed through Traefik with automatic Let's Encrypt certificates.
- **Preview deployments** — ephemeral per-PR instances with wildcard domains; enable Preview Deployments on the app to auto create/redeploy/destroy from git pull request webhooks, with the preview URL commented back on the pull request and an optional expiry (manual create still available).
- **Rollbacks** — one-click rollback to any previous deployment.
- **Monitoring** — live CPU, memory, disk and network metrics per service, plus container logs and a web terminal.
- **Multi-server** — manage remote servers over SSH; each host joins the primary Swarm as a worker or manager so apps and databases can run on any node.
- **Auto-deploy webhooks** — GitHub/GitLab/Bitbucket/Gitea push webhooks with signature verification and watch-path filters, plus a generic API-key deploy hook.
- **Environment inheritance** — org → project → environment → service env vars with per-level overrides and a merged preview.
- **Deployments overview** — org-wide and per-project deployment history with status stats and live log streaming.
- **Command palette** — ⌘K to jump to projects, services, pages and actions.
- **Notifications** — Slack, Discord, Telegram, Email, Gotify, Ntfy, Pushover, Mattermost, Lark/Feishu, Microsoft Teams and custom webhooks, with deploy success/failure events and a failure watchdog.
- **Docker control center** — full daemon control from the dashboard: containers (start/stop/restart/logs/terminal/remove), images (pull/remove/prune), Swarm nodes and services, networks, volumes, and system disk usage with prune.
- **Audit log** — every mutation recorded org-scoped (deploys, deletions, domain changes, member events, Docker actions) with a filterable Activity page; admin/owner role enforcement on destructive actions.
- **Service power tools** — duplicate any service, move services between projects/environments, clone whole environments with their services, bulk start/stop, HTTP healthchecks, CPU/memory limits and replicas.
- **Observability** — colorized logs with level badges, text/level filtering and download; 48h metrics history with range picker; a status reconciler that keeps service status truthful against real container state.
- **API, CLI & Swagger** — every tRPC procedure is also exposed as a REST endpoint authenticated with `x-api-key`, documented at `/swagger`, and drivable from the `@nixploy/cli`.
- **Templates** — one-click gallery of 86 compose-based templates in 16 categories for popular open-source tools.
- **Web server settings** — manage Traefik, Let's Encrypt email and scheduled Docker cleanup from the UI.

## Architecture

A single Node.js process (Next.js with a custom server) plus two sibling containers on a single-node Docker Swarm:

```
┌──────────────────────── Host (Docker Swarm manager) ────────────────────────┐
│                                                                             │
│   ┌──────────────┐    ┌──────────────────┐    ┌────────────────────────┐    │
│   │   nixploy    │    │ nixploy-postgres │    │    nixploy-traefik     │    │
│   │  (Next.js :  │───▶│   (PostgreSQL)   │    │  (:80 / :443, ACME)    │    │
│   │   3000)      │    └──────────────────┘    └───────────▲────────────┘    │
│   └──────┬───────┘                                        │                 │
│          │ writes dynamic YAML ──▶ /etc/nixploy/traefik/dynamic/*.yml       │
│          │ dockerode / ssh2 ─────▶ docker service create|update             │
│          │                       (user apps, databases, compose stacks)     │
│                                                                             │
│   overlay network: nixploy-network                                          │
└─────────────────────────────────────────────────────────────────────────────┘

Remote servers: Nixploy SSHes in, installs Docker if needed, and joins the
host to the primary Swarm as a worker (default) or manager. Traefik stays
cluster-wide on managers — remotes do not run an isolated swarm.
```

## Quick Start

### Production (one-liner)

On a fresh Linux server with root access:

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

With your own domain (recommended — real HTTPS via Let's Encrypt; point the DNS A record at the server first):

```bash
NIXPLOY_DOMAIN=nixploy.example.com NIXPLOY_LETSENCRYPT_EMAIL=you@example.com \
  curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

The script is **idempotent**. It detects the OS, installs Docker if needed, initializes a single-node Swarm, creates the `nixploy-network` overlay, generates secrets under `/etc/nixploy/.env`, and starts three services: `nixploy` (the app), `nixploy-postgres` and `nixploy-traefik`. All HTTP traffic redirects to HTTPS; without a domain the dashboard is served at `https://<server-ip>` with a self-signed certificate (accept the browser warning once). When it finishes, open the printed **Setup** URL and create the owner account — public `/register` is disabled after that.

A domain can also be linked later from the UI: **Settings → Server → Dashboard domain** (with DNS preflight check and automatic Let's Encrypt certificates).

Useful overrides: `NIXPLOY_VERSION`, `NIXPLOY_IMAGE`, `NIXPLOY_PORT`, `NIXPLOY_CONFIG_DIR`, `NIXPLOY_BUILD_FROM_SOURCE=1`, `NIXPLOY_SKIP_DOCKER_INSTALL=1` (see the header of `install.sh`).

The app image is published to [`ghcr.io/bablilayoub/nixploy`](https://github.com/bablilayoub/nixploy/pkgs/container/nixploy). If the pull fails (e.g. before the first CI publish), the installer builds from source automatically.

### Local development

Prerequisites: **Node.js ≥ 22**, **pnpm ≥ 10**, **Docker** running locally.

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
docker run -d --name nixploy-postgres \
  -e POSTGRES_USER=nixploy -e POSTGRES_PASSWORD=nixploy -e POSTGRES_DB=nixploy \
  -p 5432:5432 postgres:17-alpine

# 3. Configure environment
cp apps/web/.env.example apps/web/.env
# Fill in BETTER_AUTH_SECRET and ENCRYPTION_KEY:
openssl rand -hex 32   # run twice, one value per variable

# 4. Run database migrations
pnpm -F @nixploy/server db:migrate

# 5. Start the dev server
cd apps/web && pnpm dev
```

Open <http://localhost:3000>. On a fresh database the app redirects to
`/setup` so you can create the owner account (public `/register` is removed).
An organization named `<name>'s Org` is created during setup.

### CLI

```bash
pnpm -F @nixploy/cli build

# Generate an API key in the dashboard (Settings → Profile → API Keys), then:
nixploy auth login --url http://localhost:3000 --api-key nxlp_...
nixploy project list
nixploy app deploy <applicationId>
```

See [`apps/cli/README.md`](apps/cli/README.md) for the full command reference.

### REST API

Every tRPC procedure is exposed as a REST endpoint under `/api/<router>.<procedure>`, authenticated with an `x-api-key` header. Interactive documentation is served at **`/swagger`** on any running instance.

## Repository Layout

| Path | Description |
|---|---|
| `apps/web` | Next.js 16 app — UI, tRPC API routes, REST/OpenAPI surface, custom server (websockets, deploy queue, schedulers) |
| `apps/cli` | `@nixploy/cli` — command-line client for the REST API |
| `packages/server` | `@nixploy/server` — Drizzle schema, auth, deploy engine, builders, Traefik/Docker utilities, backups |
| `docker/` | Production Dockerfile, Traefik static config, dev compose file |
| `install.sh` | One-liner production installer (Docker + Swarm + app/postgres/traefik services) |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | Auth session secret (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | yes | AES key for secrets at rest (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | no | Public base URL of the app (auth callbacks, trusted origin) |
| `NIXPLOY_CONFIG_DIR` | no | Config/data directory for Traefik YAML, app code, logs (default `/etc/nixploy`) |
| `PORT` | no | HTTP port of the app process (default `3000`) |

## License

Apache-2.0
