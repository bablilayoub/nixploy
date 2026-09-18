<p align="center">
  <img src="apps/web/public/brand/nixploy-mark-light.png" alt="Nixploy" width="88" height="88" />
</p>

<h1 align="center">Nixploy</h1>

<p align="center">
  <strong>Deploy like a managed platform. Run it on your own server.</strong><br />
  Git push → build → HTTPS → database → monitoring → rollback. On hardware you control, with no per-app pricing.
</p>

<p align="center">
  <a href="https://nixploy.com">Website</a> ·
  <a href="https://nixploy.com/docs">Docs</a> ·
  <a href="https://nixploy.com/templates">145 templates</a> ·
  <a href="https://nixploy.com/agents">AI agents</a> ·
  <a href="https://nixploy.com/api">API</a> ·
  <a href="https://github.com/bablilayoub/nixploy/releases">Releases</a>
</p>

<p align="center">
  <a href="https://github.com/bablilayoub/nixploy/actions/workflows/ci.yml"><img src="https://github.com/bablilayoub/nixploy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/bablilayoub/nixploy/actions/workflows/release.yml"><img src="https://github.com/bablilayoub/nixploy/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-green" alt="Node" />
  <img src="https://img.shields.io/badge/docker-swarm-blue" alt="Docker Swarm" />
</p>

<p align="center">
  <img src="docs/images/dashboard.png" alt="Nixploy dashboard" width="880" />
</p>

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

## Why Nixploy

- **HTTPS without touching nginx or certbot.** Point DNS at the box, type the domain. Traefik issues and renews the certificate.
- **Deploy from Git, a Docker image, or a zip.** Nixpacks, Railpack, Dockerfile, buildpacks or static — detected, cached, and cancellable.
- **A database is one click, and so is restoring it.** Postgres, MySQL, MariaDB, MongoDB, Redis, with encrypted backups to S3 or disk and verified restores.
- **See why it broke.** Live logs, a web terminal into the container, 48 h of metrics, and a per-service timeline that records OOM kills, restarts and config changes.
- **Undo a bad deploy.** Roll back to any previous release, config and environment included.
- **Run many servers from one panel.** Remote hosts join over SSH; deploys, logs and backups work the same on all of them.
- **Hand it to an AI agent.** An MCP endpoint with 35 annotated tools, through the same routers as the UI — so the org scope, capability checks and audit trail still apply. [See what that looks like](https://nixploy.com/agents).
- **Nothing is paywalled.** SSO, teams, forward auth, audit export and white-labelling are in the box. There is no paid tier to upgrade to.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

With a domain (point DNS first):

```bash
NIXPLOY_DOMAIN=panel.example.com NIXPLOY_LETSENCRYPT_EMAIL=you@example.com \
  curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

Full installer options: [`docs/install.md`](./docs/install.md). Update with [`update.sh`](./update.sh).

**Releases:** [github.com/bablilayoub/nixploy/releases](https://github.com/bablilayoub/nixploy/releases) — tag `vX.Y.Z` to publish the GHCR image, changelog, and version-pinned install/update scripts. How to cut a release: [`docs/releases.md`](./docs/releases.md).

## Features

| Area | What you get |
| --- | --- |
| **Deploy** | GitHub / GitLab / Bitbucket / Gitea / generic Git, Docker images, zip · Nixpacks / Railpack / Dockerfile / buildpacks / static · BuildKit cache · PR previews (fork gate) · rollbacks |
| **Data** | Postgres, MySQL, MariaDB, MongoDB, Redis · DB backups to S3 · volume backups · **instance self-backup** (panel DB + config) |
| **Compose** | Native Compose / Swarm stacks with domains, logs, AI compose generate |
| **Edge** | Traefik v3 + Let's Encrypt / custom certs (DNS-01, expiry alerts) · redirects · basic-auth · **any domain behind the panel login** · TCP/UDP routes · traefik.me smoke hosts |
| **Observe** | Live logs & metrics (48h history) · web terminal · alert rules · uptime probes · incidents |
| **Team** | Orgs · roles (viewer→owner) · **capability overlays** · **teams + per-project access** · 2FA · **passkeys (WebAuthn)** · **SSO (OIDC, group→role)** · audit log + CSV export · quotas · **white-label** |
| **Notify** | Slack, Discord, Telegram, email, Gotify, ntfy, Pushover, Mattermost, Lark, Teams, webhooks |
| **Automate** | REST API + `/swagger` · `@nixploy/cli` (`--wait` returns a real outcome) · GitOps (`nixploy.yaml`) · **MCP** (`POST /api/mcp`, 35 annotated tools) |
| **AI** | Deploy Copilot — explain failures, confirm-gated chat, generate compose (BYO key) · `llms.txt` / `agents.md` / per-page Markdown |
| **Infra** | Remote Swarm servers · Docker control center · registries · schedules · in-app GHCR updates · `doctor` |
| **Catalog** | 145 one-click templates (15 categories), CI-checked image tags |

Product docs: [nixploy.com/docs](https://nixploy.com/docs) · API: [nixploy.com/api](https://nixploy.com/api)

## Screenshots

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <strong>Templates</strong><br />
      <img src="docs/images/templates.png" alt="Template catalog" />
    </td>
    <td width="50%" align="center" valign="top">
      <strong>Project</strong><br />
      <img src="docs/images/project.png" alt="Project services" />
    </td>
    <td width="50%" align="center" valign="top">
      <strong>Docker</strong><br />
      <img src="docs/images/docker.png" alt="Docker control center" />
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <strong>Application</strong><br />
      <img src="docs/images/service.png" alt="Application service" />
    </td>
    <td width="50%" align="center" valign="top">
      <strong>Monitoring</strong><br />
      <img src="docs/images/monitoring.png" alt="Service monitoring" />
    </td>
  </tr>
</table>

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
```

Remote servers join the primary Swarm over SSH. Details: [`docs/architecture.md`](./docs/architecture.md).

## Quick start (local development)

Prerequisites: **Node.js ≥ 22**, **pnpm ≥ 10**, **Docker** (Swarm active: `docker swarm init` if needed).

```bash
pnpm install

docker run -d --name nixploy-dev-pg \
  -e POSTGRES_USER=nixploy -e POSTGRES_PASSWORD=nixploy -e POSTGRES_DB=nixploy \
  -p 54329:5432 postgres:17-alpine

cp apps/web/.env.example apps/web/.env
```

Set in `apps/web/.env`:

```bash
DATABASE_URL=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy
BETTER_AUTH_SECRET=$(openssl rand -hex 24)   # paste the output
ENCRYPTION_KEY=$(openssl rand -hex 16)
BETTER_AUTH_URL=http://localhost:3000
```

```bash
pnpm db:migrate
cd apps/web && pnpm dev
```

Open <http://localhost:3000/setup>. Optional landing: `cd apps/landing && pnpm dev` → <http://localhost:3001>.

Full contributor guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md) · deeper setup: [`docs/development.md`](./docs/development.md).

### CLI & API

```bash
npm i -g @nixploy/cli
nixploy auth login --url http://localhost:3000 --api-key nxlp_...
nixploy doctor
```

REST paths are `GET|POST /api/<router>.<procedure>` with an `x-api-key` header. Interactive docs: **`/swagger`** on your panel. Guide: [`docs/api.md`](./docs/api.md) · [nixploy.com/api](https://nixploy.com/api).

## Docs

| Guide | Link |
| --- | --- |
| **Website docs** | [nixploy.com/docs](https://nixploy.com/docs) |
| **API reference** | [nixploy.com/api](https://nixploy.com/api) · [`docs/api.md`](./docs/api.md) |
| **Contributing** | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| Docs index (repo) | [`docs/README.md`](./docs/README.md) |
| Install | [`docs/install.md`](./docs/install.md) |
| Releases | [GitHub Releases](https://github.com/bablilayoub/nixploy/releases) · [`docs/releases.md`](./docs/releases.md) |
| Getting started | [`docs/getting-started.md`](./docs/getting-started.md) |
| MCP | [`docs/mcp.md`](./docs/mcp.md) |
| Instance backup | [`docs/instance-backup.md`](./docs/instance-backup.md) |
| Observability | [`docs/observability.md`](./docs/observability.md) |
| Auth & capabilities | [`docs/auth.md`](./docs/auth.md) |
| Docker control center | [`docs/docker.md`](./docs/docker.md) |
| Migrate from another panel | [`docs/migrate-from-another-panel.md`](./docs/migrate-from-another-panel.md) |

## Repository layout

| Path | Description |
| --- | --- |
| `apps/web` | Next.js panel — UI, tRPC, REST/OpenAPI, custom server |
| `apps/landing` | Marketing site ([nixploy.com](https://nixploy.com)) |
| `apps/cli` | `@nixploy/cli` |
| `packages/server` | Schema, auth, deploy engine, Traefik/Docker utils |
| `docker/` | Production Dockerfile, Traefik config |
| `install.sh` / `update.sh` | Production installer and updater |

## License

Apache-2.0 — contributions welcome under the same license. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
