# Getting started

After [install](./install.md), this is the shortest path to a real deploy.

## 1. Owner setup

Open the Setup URL from the installer. A short wizard walks you through the
owner account and organization name. Public registration stays off afterward;
invite teammates from **Settings → Organization**.

## 2. Deploy something trivial

**Option A — Docker image**

1. Dashboard → New project (or open the default)
2. New application → source **Docker image** → `traefik/whoami:v1.10.1`
3. Domains → add `whoami.<your-domain>` (or a `*.traefik.me` host for a quick
   local smoke — no Let's Encrypt on traefik.me)
4. Deploy → watch live logs

**Option B — Template**

Templates → pick something small (e.g. WordPress or Uptime Kuma) → deploy
sheet → Destination → Configure → Domain.

## 3. Wire Git

Settings → Git Providers → connect GitHub/GitLab/…  
On the app: source type Git, enable auto-deploy, optionally Preview
Deployments for PRs.

## 4. API / CLI

Settings → Profile → API key:

```bash
npm i -g @nixploy/cli   # published as @nixploy/cli (see apps/cli/README.md)
nixploy auth login --url https://panel.yourdomain.com --api-key nxp_...
nixploy doctor
nixploy app list --project-id <id>
nixploy compose list --project-id <id>
nixploy template list
```

Swagger lives at `/swagger` on your panel.

## 5. Optional power features

| Feature | Where |
| --- | --- |
| Deploy Copilot | Settings → Platform → Copilot; explain on Deployments; chat drawer on any service; **Generate with Copilot** on a compose service's Compose File tab drafts a compose file from a prompt (preview → accept → save) |
| Placement | Application → Advanced → Placement |
| GitOps | Project → GitOps (export / URL sync) |
| Notifications | Settings → Notifications |
| Remote servers | Settings → Servers (metrics history per server behind the chart icon) |
| Shared variables | Settings → Organization → Shared variables — org-level env inherited by every project, environment and service |
| Swarm tuning | Application → Advanced → Swarm — rolling update, rollback, restart policy, global mode, service labels, extra networks |
| Duplicate / move a service | any application, compose or database Settings tab |
| Watch paths | Application → Source — only deploy a push when a changed file matches |

## 6. Managed databases

New database → pick an engine (Postgres, MySQL, MariaDB, MongoDB, Redis) →
**Start**. Everything below lives on the service page.

### Version picker

**General → Version** offers a short list of curated tags per engine
(`packages/server/src/modules/databases/versions.ts`) with an end-of-life note
where one applies. Picking one fills the **Docker image** field for you
(`postgres:17`); choosing **Custom image…** unlocks the field again for a
variant, a fork or a pinned digest (`timescale/timescaledb:2.17-pg17`,
`postgres:17-alpine`, …). The curated version is stored in `engine_version`;
a custom image clears it, and the image stays the only source of truth.

Changing the version on a **running** instance is a data-directory migration,
not a config change:

- **Downgrades are refused.** The volume is already written in the newer
  on-disk format and the container would crash-loop. Create a new service on
  the older version and restore a backup into it.
- **Major upgrades ask for a confirmation.** Postgres in particular will not
  start on a `pgdata` directory initialised by an older major — it needs a dump
  and restore (or `pg_upgrade` by hand). Take a backup, tick *I have a current
  backup*, then reload the service. (Nixploy already pins `PGDATA` under the
  mounted volume so Postgres 18's image layout change does not silently start
  an empty cluster; see `postgresPgdata()` in `modules/databases/engine.ts`.)
- Bumps inside the same major (`8.0 → 8.4`, `11.4 → 11.8`) and any Redis change
  go through without a prompt.

The image only takes effect on the next **Reload**.

### Additional databases

One instance can host more than one logical database. **Connection → Additional
databases → Add database** creates a database plus an owning user inside the
running container:

| Engine | What is created |
| --- | --- |
| Postgres | `CREATE ROLE … LOGIN PASSWORD …` + `CREATE DATABASE … OWNER …` |
| MySQL / MariaDB | `CREATE DATABASE`, `CREATE USER …@'%'`, `GRANT ALL` on that database |
| MongoDB | `db.createUser` with the `dbOwner` role on that database |
| Redis | not offered — Redis has one keyspace |

Notes:

- The service must be **running**: Nixploy reaches the engine with `docker exec`
  into the task container, never over the network (the panel is not on the
  environment's private overlay — see [hardening](./hardening.md)).
- The password is generated server-side, stored encrypted and shown with the
  same rules as the primary credentials — members without `secrets.read` see a
  redacted row and no connection URL.
- Names and usernames are restricted to `^[a-z_][a-z0-9_]{0,62}$` and
  engine-owned names (`postgres`, `mysql`, `admin`, …) are rejected. The SQL is
  piped over **stdin**, so no password ever appears in `ps` on the host.
- Deleting drops the database *and* its user. There is no undo, and the
  scheduled backups only cover the instance's primary database — dump extra
  databases yourself if they matter.

REST/CLI: `<engine>.engineVersions`, `<engine>.listLogicalDatabases`,
`<engine>.createLogicalDatabase`, `<engine>.deleteLogicalDatabase`.

### Reaching a database from outside

Prefer the internal URL (`<appName>:5432`) from services in the same
environment. **General → External port** publishes the port on the host for
external tools; it binds every interface, so firewall it. For SNI-based routing
of several TCP services behind one port, see
[TCP and UDP routing](./domains-traefik.md#tcp-and-udp-routing-layer-4).

## Next reading

- [Install](./install.md)
- [Migrate from Dokploy](./migrate-from-dokploy.md) /
  [Coolify](./migrate-from-coolify.md)
- [Domains & Traefik](./domains-traefik.md)
- [Deployment flow](./deployment-flow.md)
- [Architecture](./architecture.md)
