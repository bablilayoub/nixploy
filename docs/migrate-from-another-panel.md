# Migrate from another panel

Nixploy is intentionally familiar if you have run a self-hosted PaaS before:
the same shape (org → project → environment → services, Docker Swarm +
Traefik, templates, API keys). There is **no one-click import** of another
panel's database yet — you recreate services and point traffic when ready.
This guide maps the concepts and describes a safe cutover.

## Concept map

Most panels use one of two vocabularies. Both land in the same place here.

| Elsewhere | Nixploy |
| --- | --- |
| Organization / Team | Organization |
| Project (+ Environment) | Project → Environment |
| Application / Resource (Git or image) | Application |
| Compose resource / stack | Compose (`docker compose` or stack) |
| Databases | First-class Postgres / MySQL / MariaDB / Mongo / Redis |
| Domains, proxy UI, Traefik labels | Domains (managed Traefik YAML, never hand-edited labels) |
| Servers / destinations | Servers → join the primary Swarm over SSH |
| Preview / review apps | Preview deployments + PR comments |
| Deploy webhooks | Provider webhooks + a generic API-key deploy hook |
| API tokens | API keys (`x-api-key`) + `@nixploy/cli` / OpenAPI |
| Notifications | Slack, Discord, Telegram, … and more |
| One-click catalogue | Templates gallery |

## What transfers easily

- **Git apps** — same repository URL, branch and build type (Dockerfile,
  Nixpacks, Railpack, buildpacks, static)
- **Docker image apps** — copy the image reference and the env
- **Compose stacks** — paste `docker-compose.yml` + `.env`, keep them in Git,
  point at a raw URL, or bring them in as GitOps YAML
- **Env files** — paste into the service's Environment tab (encrypted at rest)
- **Domains** — create them in Nixploy, lower the DNS TTL, flip the A/CNAME
  record when the new instance is green
- **S3 backup destinations** — recreate the credentials, then the schedules

## What does not transfer automatically

- Running containers and volumes from the old host (export database dumps and
  volume backups yourself)
- The old panel's internal catalogue (services, ids, deployment history)
- Its exact proxy configuration or middleware names — Nixploy regenerates its
  own Traefik YAML

## What usually needs a rethink

| Pattern elsewhere | In Nixploy |
| --- | --- |
| Per-server isolated stacks | One primary Swarm; remote servers join as worker or manager |
| Separate build server and deploy server | Same Swarm — use **Advanced → Placement** constraints |
| "Destinations" | Servers, plus optional placement labels |
| A proxy you configure by hand | Traefik file provider, written by Nixploy |

One difference worth planning for: **each environment gets its own private
overlay network**, so a service resolves only the services of its own
environment. Put things that talk to each other in the same environment.

## Recommended cutover

1. **Install Nixploy** on a fresh host (or a spare VPS) — see
   [install.md](./install.md). Do **not** tear the old panel down until the
   traffic has moved.
2. Recreate **one** non-critical app end to end (domain + TLS + health).
3. For each production service:
   - Create the application / compose / database in Nixploy
   - Copy the env vars (prefer regenerating secrets where you can)
   - Deploy and verify on a temporary hostname if possible
4. For databases: take a dump from the old instance, create the database here,
   restore into it, then repoint the app's connection URL.
5. **Lower the DNS TTL** a day ahead, then point the production hostname at
   Nixploy.
6. Keep the old panel read-only for a few days as a rollback path, then
   decommission it.

## Backups

Recreate the S3-compatible destinations under **Settings → Backup storage**,
then attach a backup schedule to each database. Run a manual backup and a
restore drill before deleting any volumes on the old host.

## GitOps tip

Export a Nixploy stack from **Project → GitOps → Export**, commit
`nixploy.yaml` to git, and use **Sync from URL** on other environments. Env
*values* stay out of the file — only keys are referenced.

## Why teams switch

- Deploy Copilot (explain failed builds, apply env patches, redeploy)
- A status reconciler that keeps the UI honest against Docker
- Org-scoped audit log, capability-based roles and free SSO
- Template images verified in CI
- Primary-swarm multi-server (remotes join one Swarm; Traefik stays on managers)
- Swarm rolling updates and Traefik routing without fighting a proxy UI

## Need help?

Open an issue on [GitHub](https://github.com/bablilayoub/nixploy) with what
you are migrating (app / compose / database) and where it stuck.
