# Migrate from another panel

Nixploy is intentionally familiar if you have run a self-hosted PaaS before:
the same shape (org → project → environment → services, Docker Swarm +
Traefik, templates, API keys). For a panel whose API the importer speaks
(Dokploy and Coolify), one environment at a time comes over with
`nixploy import`; for everything else, recreate the services by hand. Either
way you point traffic when the new instance is green. This guide covers the
importer first, then the concept map and the cutover.

## Import in the panel

Open **Migrations** in the navigation or command palette. Access requires
`gitops.manage`; the source key's permissions determine the inventory you can
read. Choose **Live API** for Dokploy or Coolify, or **Upload dump** for a Dokploy PostgreSQL dump.
Keys are sent in mutation bodies and held only in page memory; changing the
source, completing an import, starting over or leaving clears them. Uploaded
dumps belong to the current organization and expire after 24 hours.

1. Inspect the source, then choose its project and environment.
2. Select the services to copy and an accessible target project and environment.
   Leaving the target project at its default matches the source name or creates
   it. Generated runtime names are the safer default for a separate target;
   keeping source names is an explicit option.
3. Generate a plan. Review the counts, create/update/no-op actions, changed
   field names and compatibility notes. Download the redacted report if useful.
   Executable Compose/Dockerfile/command text and credential-bearing fields
   are omitted from reports, while they remain available to the internal apply.
4. Acknowledge the plan and choose **Import configuration**. Changing a source,
   selection or target invalidates the review. Source-value or target-diff
   changes discovered at apply require a fresh plan. Permission checks and
   writes use one source snapshot.
5. Review applied/failed changes and unmatched value sets. Open the target
   project to restore secrets, database data and persistent files, check server
   and registry access, explicitly deploy, and diagnose domains before cutover.
   A partial import is retryable through a new plan; existing mappings keep ids
   stable and unreadable encrypted values preserve manual replacements.

Capabilities are checked again by the server: `secrets.write` for values,
`project.write` for project/environment creation, and service create/write
capabilities based on the plan. Instance-admin-only settings retain their gate.
Only projects allowed by the caller's organization and teams can be targeted.

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
counts); `--json` also includes namespaced service ids for `--service <kind/id>`
selection. Repeat `--service` on plan and apply to select a subset. Plan output
includes a review token: pass it to apply with `--review-token <token>` to reject
source-value or target-setting changes since review. Omit the token only when
you deliberately want to apply a freshly fetched configuration. The importer reads project details as well as the list, because
the source list omits database names and environment-level env. `plan`
fetches the environment, prints the translation's notes and
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
  friends), then restore database data from a backup separately.
- **Compose mounts** — here a compose mount names the container it goes in,
  which the source does not record; add them under the stack's Advanced
  tab.
- **File mounts** — recreate their files and contents in the target's
  Advanced tab. Import does not write or remove backing files that a
  running target service may already use.
- **Named application volumes** must belong to the target application's
  `appName`. A source volume outside that namespace, or one imported with
  `--no-keep-app-names`, needs a new target volume and a separate data
  restore. If any mount needs manual translation, the importer leaves the
  entire target mount collection alone; it does not remove replacement
  mounts on a repeat apply. Target-only compose redirects, basic auth,
  build args and preview env are also left alone.
- **Custom certificates, custom ACME resolvers, strip-path, uploaded
  archives, git submodules, libSQL databases** — not supported here, each
  reported with the service it belonged to.
- **Bind mounts and Swarm network overrides** need the instance admin to
  apply, exactly as in the panel.

`--no-keep-app-names` generates fresh `appName`s instead of keeping the
source's; keep them (the default) when a same-host takeover is the plan,
because the old volumes are named after them.

## Coolify live API support

Select **Coolify** in Migrations, or pass `--source coolify` to the CLI. Use the
panel origin; Nixploy calls `/api/v1` with a transient Bearer token. On the
source, enable API access and allow the target's address. A read token lists
configuration; `read:sensitive` is required to copy readable env values and raw
Compose content. See the [official API setup](https://coolify.io/docs/api/overview).

The supported configuration slice is projects/environments, Docker-image and
public credential-free Git applications (Dockerfile, Nixpacks, Railpack and
static settings), raw/one-click Compose **services**, standalone PostgreSQL,
MySQL, MariaDB, MongoDB and Redis configuration, and HTTP domain URLs. Source
Compose services become a raw snapshot here; repository tracking, source proxy
settings and external files require manual setup. Repository-backed Compose
**applications** and other database engines are counted as unsupported with
notes. This is not a Coolify database-dump or same-host adoption path.

Coolify runtime names are not reused. Server keys, private provider and registry
connections, shared-variable libraries/references, custom commands, source
published ports, mounts, schedules, backups and proxy middleware need manual
review. A domain whose backend port is unavailable leaves the target collection
alone; an exposed-port fallback explicitly asks you to confirm overrides.
Hidden/null/once-only, shared-reference or unrepresentable variable groups are
omitted, with notes, rather than replacing existing target values or copying
ciphertext. Database passwords are generated for new targets and retained on
repeat imports; source credentials/data are not migrated.

Verified against an isolated official **Coolify v4.4.6** API: image/public-Git
applications, a raw Compose service, all five database configuration kinds,
two domains, plus explicit KeyDB/repository-Compose rejections. Read-token
repeat preserves manually restored values/settings, IDs and database passwords.
Import alone leaves Docker inventory and proxy configuration unchanged. Runtime
proof for imported database engines other than PostgreSQL is still separate
from configuration/schema coverage.

## Import from a database dump (the source panel is dead)

The same importer, offline: `pg_dump` the source panel's own Postgres —
`docker exec <its postgres container> pg_dump -U <user> <db> | gzip >
panel.sql.gz` on the old host, or any dump you still have — and hand it over
instead of a URL and a key.

```bash
nixploy import inspect --source dokploy --dump-file panel.sql.gz
nixploy import plan    --source dokploy --dump-id <id from inspect> --source-project prj_123
nixploy import apply   --source dokploy --dump-id <id> --source-project prj_123
```

`--dump-file` uploads the dump (`POST /api/import/dump`, up to 512 MiB,
plain SQL, gzipped or custom format, `gitops.manage`) and prints a `dumpId`
that is valid for 24 hours; the maintenance pass removes it after that.
Every read restores the dump into a **throwaway Postgres container on no
network** (`postgres:17-alpine`, 1 GiB, removed afterwards — the same
pattern as backup restore verification), reads the source's rows with
`row_to_json`, and never touches the panel's own database. The source's rows
carry the same column names its API returns, so both paths use the same
translation; the child tables (`domain`,
`mount`, `port`, `redirect`, `security`) are found by name in the restored
schema, with absent child tables read as empty collections.

**Env values from a dump.** Recent versions of the source encrypt env at
rest. The importer does not read the source keyring: encrypted columns are
omitted with a note asking you to paste their **keys and values** before
deploying. An encrypted column does not reveal even its key names. Plaintext
`KEY=VALUE` columns still import. Existing target values are preserved for
every encrypted column, so repeating an offline import keeps values you
already restored manually. Everything else in the notes (git providers,
basic-auth hashes, database passwords, compose mount targets) is the same
as over the API.

### Verified source and limits

On 2026-10-15, both paths were exercised against the official
[Dokploy v0.30.8 image](https://github.com/Dokploy/dokploy/releases/tag/v0.30.8)
(`sha256:e8789a3f71a1e50d817836ad222ee0eab8ee69fc1b0451fee189a880b5602871`).
The source ran with a separate nested Docker daemon, and its application,
compose stack, Postgres database, domains, inherited env and basic auth
were created through its real API. The offline input was a `pg_dump` of
that running source database.

Inspect, plan, apply and repeat apply passed on both paths. Fresh imports
left the Docker service inventory unchanged, wrote no proxy routes and
created no deployment jobs. Seven encrypted dump columns produced manual
input notes, and repeat apply kept the manually supplied values and
replacement volume mount. After those steps, explicit application and
compose deployments completed, both HTTP hosts answered through an
isolated Traefik, and Postgres accepted the regenerated target password.
Plans were checked for source credentials and controlled secret values.
The real database deployment covered Postgres; the other engines retain
schema and unit coverage. This does not verify source data migration,
public DNS/TLS, or adoption of a source host's running services and volumes.

The regression checks run with the existing server suite:

```bash
pnpm -F @nixploy/server exec vitest run src/modules/import src/modules/gitops/secrets.test.ts
DATABASE_URL_TEST=<isolated-migrated-database> pnpm -F @nixploy/server exec vitest run src/modules/import/import.db.test.ts src/modules/gitops/secrets.db.test.ts
```

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

### Or: flip DNS once, move services one at a time

The cutover above moves each hostname when its service is ready, which means
one DNS change per service and a TTL wait each time. **External upstreams**
turn that around: register the old host as an upstream in Nixploy
(`Add service → External upstream`, target `https://old-host.example.com`),
attach every production hostname to it with Let's Encrypt, point DNS at
Nixploy **once** — every hostname now answers from the old box through the
new proxy, with a fresh certificate — and then, service by service, recreate
the workload in Nixploy and move the hostname from the upstream to the new
service. No window where a hostname answers nowhere, no big-bang evening, and
the old host is still serving whatever has not moved yet. Details and the
target rules in
[domains-traefik.md](./domains-traefik.md#external-upstreams).

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
