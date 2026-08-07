# Migrate from Coolify

Coolify and Nixploy both self-host apps on your servers. The mental models
differ (Coolify leans Docker Compose / multi-server destinations; Nixploy is
org → project → environment on **Docker Swarm + Traefik**). There is **no
automatic Coolify import** — recreate services and flip DNS when ready.

## Concept map

| Coolify | Nixploy |
| --- | --- |
| Team / Project | Organization / Project |
| Environment / Resource | Environment → Application, Compose, or Database |
| Application (Git / Docker) | Application |
| Docker Compose resource | Compose service |
| Databases | First-class Postgres / MySQL / MariaDB / Mongo / Redis |
| Domains / Proxy | Domains via Traefik (Let's Encrypt or none) |
| Servers / Destinations | Servers (SSH join primary Swarm) |
| Deploy webhooks | Provider webhooks + generic API-key hook |
| API tokens | API keys (`x-api-key`) + CLI / Swagger |

## What transfers easily

- **Git repositories** — clone URL, branch, Dockerfile path or Nixpacks
- **Public/private Docker images** — image name + registry credentials
- **Compose files** — paste into Compose (raw) or keep in git and redeploy
- **Env files** — copy into the service Environment tab (encrypted at rest)
- **Custom domains** — recreate in Nixploy, then move DNS

## What usually needs a rethink

| Coolify pattern | In Nixploy |
| --- | --- |
| Per-server isolated stacks | One primary Swarm; remotes join as worker/manager |
| Build server vs deploy server | Same Swarm; use **Advanced → Placement** constraints |
| Coolify “destinations” | Servers + optional placement labels |
| Coolify proxy UI | Traefik file provider managed by Nixploy |

## Recommended cutover

1. Install Nixploy on a **new** host — [install.md](./install.md). Keep Coolify
   up until cutover succeeds.
2. Migrate a small Git app first (whoami or a staging site).
3. For databases: take a dump from Coolify, create the DB in Nixploy, restore,
   then point the app’s connection URL at the new host.
4. For compose stacks: paste compose + env, deploy, attach domains.
5. Flip DNS (lower TTL first). Watch Deployments + Monitoring for a day.
6. Decommission Coolify when you’re confident.

## Backups

Recreate S3-compatible destinations under **Settings → Backup storage**, then
attach backup schedules on each database. Do a manual backup/restore drill
before deleting Coolify volumes.

## Why teams switch

- Swarm rolling updates and Traefik routing without fighting Coolify’s proxy
- Deploy Copilot on failed builds
- Templates catalog with image health checks in CI
- Audit log and clearer org roles
- GitOps-lite (`nixploy.yaml` export / URL sync + redeploy)

## Need help?

File an issue on [GitHub](https://github.com/bablilayoub/nixploy) — include
Coolify resource type (app / compose / DB) and the error or gap you hit.
