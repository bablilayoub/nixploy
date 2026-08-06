# Migrate from Dokploy

Nixploy is intentionally familiar if you know Dokploy (same shape: org →
project → environment → services, Swarm + Traefik, templates, API keys). There
is **no one-click import** of an existing Dokploy database — you recreate
projects and point traffic when ready. This guide maps concepts and a safe
cutover.

## Concept map

| Dokploy | Nixploy |
| --- | --- |
| Organization | Organization |
| Project / Environment | Project → Environment |
| Application | Application (same source/build types) |
| Compose | Compose (`docker compose` / stack) |
| Databases | Postgres / MySQL / MariaDB / Mongo / Redis |
| Domains + Traefik | Domains + Traefik (file provider) |
| Preview deployments | Preview deployments + PR comments |
| Servers (SSH) | Servers → join primary Swarm |
| API key / CLI | API key + `@nixploy/cli` / OpenAPI |
| Notifications | Slack, Discord, Telegram, … + more |
| Templates | Templates gallery |

## What transfers easily

- **Git apps** — same repo URL, branch, build type (Dockerfile / Nixpacks / …)
- **Docker image apps** — copy the image ref and env
- **Compose stacks** — paste `docker-compose.yml` + `.env` (or use GitOps YAML)
- **Domains** — create domains in Nixploy, lower DNS TTL, flip A/CNAME when green
- **S3 backup destinations** — recreate destination credentials, then schedules

## What does not transfer automatically

- Running containers / volumes from the old host (export DB dumps / volume
  backups yourself)
- Dokploy’s internal Postgres catalog (apps, IDs, history)
- Exact Traefik YAML / middleware names (Nixploy regenerates its own)

## Recommended cutover

1. **Install Nixploy** on a fresh host (or a spare VPS) — see
   [install.md](./install.md). Do **not** wipe Dokploy until traffic is moved.
2. Recreate **one** non-critical app end-to-end (domain + TLS + health).
3. For each production service:
   - Create the application / compose / database in Nixploy
   - Copy env vars (prefer regenerating secrets where you can)
   - Deploy and verify on a temporary hostname if possible
4. **Lower DNS TTL** a day ahead, then point the production hostname at Nixploy.
5. Keep Dokploy read-only for a few days as rollback; then decommission.

## GitOps tip

Export a Nixploy stack from **Project → GitOps → Export**, commit
`nixploy.yaml` to git, and use **Sync from URL** on other environments. Env
*values* stay out of the file — only keys are referenced.

## Why teams switch

- Deploy Copilot (explain failed builds, apply env patches, redeploy)
- Status reconciler that keeps UI status honest vs Docker
- Org-scoped audit log + role gates on destructive ops
- Template images verified in CI
- Primary-swarm multi-server (remotes join one Swarm; Traefik stays on managers)

## Need help?

Open an issue on [GitHub](https://github.com/bablilayoub/nixploy) with what
you’re migrating (app / compose / DB) and where it stuck.
