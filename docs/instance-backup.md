# Instance backups (web-server)

How to back up the Nixploy instance itself — its Postgres database **and** its
config directory — and how to restore them by hand. Redis service backups are
covered at the end.

## What gets backed up

Every run produces **two artifacts** in the destination bucket:

| Artifact | Key layout | Contents |
| --- | --- | --- |
| Database dump | `<prefix>/web-server/<timestamp>.gz` | `pg_dump --no-owner --no-privileges` of the `DATABASE_URL` database (gzipped SQL) |
| Config archive | `<prefix>/web-server-config/<timestamp>.gz` | tar.gz of the config directory (`NIXPLOY_CONFIG_DIR`, default `/etc/nixploy`) |

The config archive includes everything under the config dir **except**
derived/heavy subtrees (`applications/`, `compose/`, `logs/`, `metrics/`,
`cache/`, `tools/`, `files/`). What remains is the state an instance restore
actually needs:

- `traefik/` — static config, file-provider dynamic YAML (routes, TLS),
  `acme.json` (Let's Encrypt account + certificates)
- `ssh/` — SSH keys for managed servers, pinned known-hosts

> **Sensitivity:** the dump contains all tenants' data (secrets are encrypted
> at rest, but readable with your `ENCRYPTION_KEY`), and the archive contains
> TLS private keys and SSH private keys in plain text. Point instance backups
> at a private bucket with tight IAM.

Retention (`keepLatestCount`) prunes each artifact stream independently, same
as database backups.

## How the dump runs

The runner parses `DATABASE_URL` from the environment. It prefers a local
`pg_dump` (password passed via the `PGPASSWORD` process environment, never on
argv). The stock app image ships `postgresql-client` for that path. When
`pg_dump` is still missing (custom/dev images), it falls back to running
`pg_dump` inside the instance's own Postgres container, located by the
`DATABASE_URL` host name (`nixploy-postgres` as a Swarm service in production,
`postgres` as a compose service in `docker-compose.dev.yml`). If neither works,
the backup fails with an explicit error; installing a Postgres client on the
host (`apk add postgresql-client`, `apt install postgresql-client`,
`brew install libpq`) fixes that.

## Scheduling

Settings → **Backup storage** → **Instance backups** → *Create instance
backup*. Pick a cron schedule, an S3 destination, a prefix and an optional
keep-latest count — identical to database backups. Creating an instance
backup requires the org **admin** role (it captures every tenant's data).
Run-now, edit, enable/disable and delete work like any other backup row.

## Restoring (manual)

There is no one-click restore on purpose: you are typically restoring onto a
**fresh** host where the panel does not run yet.

1. **Provision the new host.** Install Docker, then install Nixploy per
   [install.md](./install.md), but stop before logging in. Make sure the
   instance uses the **same** `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` as the
   old one — otherwise encrypted columns (env vars, credentials) are
   unreadable after the restore.

2. **Fetch the artifacts** from your bucket (replace prefix/timestamps):

   ```bash
   aws s3 cp s3://<bucket>/backup/web-server/<ts>.gz dump.sql.gz
   aws s3 cp s3://<bucket>/backup/web-server-config/<ts>.gz config.tar.gz
   ```

3. **Restore the database.** The dump is plain SQL:

   ```bash
   # against the instance Postgres (service name from install.sh):
   gunzip -c dump.sql.gz | docker exec -i $(docker ps -qf name=nixploy-postgres) \
     psql -U nixploy -d nixploy -v ON_ERROR_STOP=1
   ```

   If you are restoring into a Postgres that already has data, drop and
   recreate the `nixploy` database first (the dump was taken with
   `--no-owner --no-privileges`, so no role fixups are needed).

4. **Restore the config directory** (default `/etc/nixploy`, or whatever
   `NIXPLOY_CONFIG_DIR` points at):

   ```bash
   mkdir -p /etc/nixploy
   tar xzf config.tar.gz -C /etc/nixploy
   ```

5. **Recreate the platform services** — rerun `install.sh` (or
   `docker service update --force nixploy` + `nixploy-traefik`). Traefik picks
   up the restored dynamic configs and certificates; the app runs migrations
   on boot (`pnpm db:migrate` semantics) and your orgs, projects and
   deployments are back.

6. **Redeploy affected services** as needed — the database knows about them,
   and container state is reconciled automatically for services whose images
   still exist in the registry.

## Redis backups

Redis services are backed up like any other database engine (service →
Backups tab → *Create backup*):

- The runner executes `redis-cli BGSAVE` inside the container (falling back
  to a blocking `SAVE`), waits until `rdb_bgsave_in_progress` is `0` and
  verifies `rdb_last_bgsave_status: ok`.
- It then `docker cp`s the whole Redis data directory (`CONFIG GET dir`,
  usually `/data`) — that is `dump.rdb` **plus the AOF** (`appendonlydir/`)
  when `appendonly` is enabled — into a gzipped tar on S3 at
  `<prefix>/<appName>/<timestamp>.gz`, with the same retention semantics as
  SQL dumps.
- **Restore** (Backups tab → restore icon, or `backup.restore`) unpacks the
  tar back into the container and issues `SHUTDOWN NOSAVE`; the Swarm
  restart policy brings Redis back and it loads the restored files from
  disk. When an AOF is present Redis replays it preferentially over the RDB,
  which is exactly what you want — both are restored from the same snapshot.
