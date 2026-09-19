# Migrate from another panel

Nixploy is intentionally familiar if you have run a self-hosted PaaS before:
the same shape (org → project → environment → services, Docker Swarm +
Traefik, templates, API keys). For a panel whose API the importer speaks
(currently Dokploy), one environment at a time comes over with
`nixploy import`; for everything else, recreate the services by hand. Either
way you point traffic when the new instance is green. This guide covers the
importer first, then the concept map and the cutover.

## Import over the source's API

The importer reads one project environment from the source panel through
its REST API, translates it to a [version-2 `nixploy.yaml`](./gitops.md)
plus the env values, and applies both here. **It deploys nothing**: the
services land `idle`, with a list of notes for what did not carry over, and
you deploy each one when the notes are dealt with.

```bash
export NIXPLOY_IMPORT_API_KEY='<a read-capable API key of the source panel>'
nixploy import inspect --source dokploy --url https://old-panel.example.com
nixploy import plan   --source dokploy --url https://old-panel.example.com --source-project prj_123
nixploy import apply  --source dokploy --url https://old-panel.example.com --source-project prj_123
```

`inspect` lists what the key can see (projects, environments, service
counts). `plan` fetches the environment, prints the translation's notes and
the diff against the target (every item is a create when the target project
does not exist yet) and writes nothing. `apply` creates the project and the
environment when missing, writes the rows, then writes the env values. The
source key is passed per call and never stored; audit rows carry the source
host and counts only. The source URL goes through the same egress guard as
every tenant URL, so a panel on a private address needs the instance's
private-egress toggle.

What comes over: applications (source, build settings, resources, Swarm
overrides, preview flags, domains with paths and internal paths, mounts,
published ports, redirects, by-name server and registry references),
compose stacks (inline file or git source, isolation, container-scoped
domains), the five database engines (image, name, user, resources, external
port), and the env of the project, the environment and every service,
including build args and preview env.

What the notes will tell you to do by hand, because it cannot be carried:

- **Git provider connections** — the source's GitHub/GitLab/Bitbucket/Gitea
  app is not yours; connect the provider here and select it on each
  service before the first deploy. The repository, owner and branch are
  already set.
- **Basic auth** — the source stores hashes; re-create the entries with
  their passwords.
- **Database passwords** — every imported database gets a new password;
  update the env values that carry the old one (`DATABASE_URL` and
  friends), or adopt the old volume with the takeover tool when it lands.
- **Compose mounts** — here a compose mount names the container it goes in,
  which the source does not record; add them under the stack's Advanced
  tab.
- **Custom certificates, custom ACME resolvers, strip-path, uploaded
  archives, git submodules, libSQL databases** — not supported here, each
  reported with the service it belonged to.
- **Bind mounts and Swarm network overrides** need the instance admin to
  apply, exactly as in the panel.

`--no-keep-app-names` generates fresh `appName`s instead of keeping the
source's; keep them (the default) when a same-host takeover is the plan,
because the old volumes are named after them.

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
