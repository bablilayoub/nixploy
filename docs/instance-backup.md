# Backups (destinations, run history, instance self-backup)

How to back up the Nixploy instance itself — its Postgres database **and** its
config directory — and how to restore them by hand. The parts that apply to
*every* backup (where archives are stored, run history, restore verification)
are covered first; Redis service backups are covered at the end.

## Backup destinations (S3 or local disk)

Settings → **Backup storage** holds the destinations every database, volume and
instance backup writes to. Two providers share one key layout
(`<prefix>/<appName>/<ISO-timestamp>.gz`):

| Provider | Where archives land | Who can create it |
| --- | --- | --- |
| `s3` (default) | the S3-compatible bucket of the destination row | anyone with `destinations.manage` |
| `local` | `<config dir>/backups/<organizationId>/<key>` on the **panel host** | instance admin only |

A local destination needs a name only — no bucket, region, endpoint or keys.
Its on-disk root is reported back as `storagePath` on `destination.all` /
`destination.one` and shown in the UI. `testConnection` writes and deletes a
probe file instead of listing a bucket, and archives are written
write-then-rename (`<file>.part` → `<file>`) so a crash mid-write never leaves
a truncated file that retention would count as a good backup.

Two things to know before pointing production at `local`:

- **It is the Nixploy host's disk, never the database's host.** Dumps from a
  remote managed server still travel back through the panel process, so they
  land on the panel's config volume.
- **A lost host takes those backups with it.** Local destinations are for a
  quick second copy, an air-gapped install or trying backups out — not a
  disaster-recovery plan. Keep an off-host copy (S3, `rsync`, snapshots).

`keepLatestCount` retention, restore and verification behave identically for
both providers; only the `provider` column differs. The provider cannot be
changed after creation (a local row has no bucket settings to update).

## Run history

Every execution of a database dump, volume archive, instance export or restore
verification is one `backup_run` row: inserted as `running` before any work
starts, then finalised as `success` (with the object key and archive size) or
`error` with a **redacted** message — command lines are cut back to the program
name and the destination's keys and the database password are masked, so a
failure is safe to show in the UI and to fan out over notifications.

- `trigger` is `schedule` (cron tick), `manual` (run-now) or `verify`.
- `kind` is `database`, `volume` or `instance`.
- The lists in Backups / Volume backups / Instance backups badge each row with
  its last run; the history icon opens the last 20 runs with status, trigger,
  duration, size and the stored object.
- The newest 200 runs per backup are kept; older rows are pruned after each
  run. Stored archives are pruned separately by `keepLatestCount`.
- API: `backup.runs({ backupId, limit? })` and
  `volumeBackup.runs({ volumeBackupId, limit? })`; `backup.all` /
  `volumeBackup.all` carry a `lastRun` summary. Reads are org-scoped (no extra
  capability, same as the backup rows themselves); manual runs, restores and
  verifications need `backups.manage` and are written to the audit log.

## Restore verification ("Verify")

`backup.verify({ backupId, key? })` — the shield button on a successful run —
proves a stored dump actually restores, without touching the live service:

1. Start a throwaway container from the **source service's own image**, named
   `nixploy-verify-<random hex>`, with **no published ports**, `--network none`
   and a `nixploy.verify=1` label. It needs no real credentials (Postgres runs
   with `POSTGRES_HOST_AUTH_METHOD=trust`, MySQL/MariaDB with an empty root
   password, Mongo and Redis without auth), so no secret reaches `docker run`
   argv.
2. Wait for the engine's readiness probe (container logs are attached to the
   error when it never comes up).
3. Restore the archive into it over stdin, then run the engine's liveness query
   (`SELECT 1`, `db.stats().ok`, `PING` → `PONG`).
4. Remove the container in a `finally` block whatever happened.

The whole thing is time-boxed to 10 minutes and recorded as a `backup_run` with
`trigger: "verify"`, so a verification that fails is visible in the history
next to the dump it rejected. Instance (`web-server`) dumps are verified
against the stock Postgres image, since the instance dump is plain SQL.

## What gets backed up (instance)

Every instance run produces **two artifacts** in the destination:

| Artifact | Key layout | Contents |
| --- | --- | --- |
| Database dump | `<prefix>/web-server/<timestamp>.gz` | `pg_dump --no-owner --no-privileges` of the `DATABASE_URL` database (gzipped SQL) |
| Config archive | `<prefix>/web-server-config/<timestamp>.gz` | tar.gz of the config directory (`NIXPLOY_CONFIG_DIR`, default `/etc/nixploy`) |

The config archive includes everything under the config dir **except**
derived/heavy subtrees (`applications/`, `compose/`, `logs/`, `metrics/`,
`cache/`, `tools/`, `files/`) and the panel's own secrets file (`.env`, plus
any `.env.*` copy). What remains is the state an instance restore actually
needs:

- `traefik/` — static config, file-provider dynamic YAML (routes, TLS),
  `acme.json` (Let's Encrypt account + certificates)
- `ssh/` — SSH keys for managed servers, pinned known-hosts

### `.env` is NOT in the archive — back it up yourself

`install.sh` writes `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`
and `POSTGRES_PASSWORD` to `<config dir>/.env` (`/etc/nixploy/.env`). The
instance backup deliberately excludes that file: the database dump holds
every tenant's credentials encrypted with `ENCRYPTION_KEY`, and shipping the
key in the same bucket would hand all of them to anyone who can read it
(leaked destination credentials, a public bucket, provider staff).

Keep a copy of `.env` somewhere the bucket reader cannot reach — a password
manager, an offline vault, a separate KMS-encrypted secret. **A restore
without the original `ENCRYPTION_KEY` cannot decrypt anything stored**:
env vars, database passwords, registry/git/SSH credentials, S3 keys and
notification configs are unrecoverable, and every service must be
re-configured by hand. `BETTER_AUTH_SECRET` matters less (existing sessions
become invalid), `POSTGRES_PASSWORD`/`DATABASE_URL` only need to match the
Postgres you restore into.

> **Sensitivity:** the dump contains all tenants' data (secrets are encrypted
> at rest, but readable with your `ENCRYPTION_KEY`), and the archive contains
> TLS private keys and SSH private keys in plain text. Point instance backups
> at a private bucket with tight IAM.

Retention (`keepLatestCount`) prunes each artifact stream independently, same
as database backups. Instance backups can only be created, edited or run by
the **instance admin** (the first user), never by an org admin — the dump
contains every tenant.

Every dump pipeline captures the producer's exit status (a failed `pg_dump`
or `tar` fails the run instead of uploading an empty archive) and rejects
gzip files that decompress to zero bytes. Restores stream the archive over
stdin, so large dumps are not limited by the shell's argument size.

> **Size ceiling.** Dumps and archives are still buffered in the panel
> process: the gzipped bytes travel back base64-encoded through a 50 MB
> `maxBuffer`, so a raw dump much above ~37 MB compressed fails and peak
> memory is roughly 3× the archive. Multipart streaming to S3 is tracked in
> docs/status.md; until then keep an eye on run sizes in the history.

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
backup*. Pick a cron schedule, a destination, a prefix and an optional
keep-latest count — identical to database backups. Creating, editing, running
or deleting an instance backup requires the **instance admin** (the first
user), never merely an org admin: the dump captures every tenant's data.
Run-now, enable/disable, run history and verify work like any other backup row.

## Restoring (manual)

There is no one-click restore on purpose: you are typically restoring onto a
**fresh** host where the panel does not run yet.

1. **Provision the new host.** Install Docker, then install Nixploy per
   [install.md](./install.md), but stop before logging in. Then put your
   **own** copy of the old `.env` in place (`/etc/nixploy/.env`, mode 600)
   — it is not in the backup. The instance must run with the **same**
   `ENCRYPTION_KEY` (and ideally `BETTER_AUTH_SECRET`) as the old one;
   otherwise every encrypted column (env vars, credentials, S3/notification
   configs) is unreadable after the restore and has to be re-entered.
   `DATABASE_URL`/`POSTGRES_PASSWORD` must match the Postgres you restore
   into; keep the installer's fresh values if you let it create Postgres.

2. **Fetch the artifacts** from your destination (replace prefix/timestamps):

   ```bash
   # S3 destination:
   aws s3 cp s3://<bucket>/backup/web-server/<ts>.gz dump.sql.gz
   aws s3 cp s3://<bucket>/backup/web-server-config/<ts>.gz config.tar.gz

   # local destination — copy them off the OLD host first:
   # <config dir>/backups/<organizationId>/backup/web-server/<ts>.gz
   # <config dir>/backups/<organizationId>/backup/web-server-config/<ts>.gz
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
   `docker service update --force nixploy` + `nixploy-traefik`) so the
   `nixploy` service picks up the restored `.env`. Traefik picks up the
   restored dynamic configs and certificates; the app runs migrations on
   boot (`pnpm db:migrate` semantics) and your orgs, projects and
   deployments are back. Open a service's environment tab: if values show
   as garbage or decryption errors appear in the logs, the `ENCRYPTION_KEY`
   in `.env` is not the original one.

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
  when `appendonly` is enabled — into a gzipped tar in the destination at
  `<prefix>/<appName>/<timestamp>.gz`, with the same retention semantics as
  SQL dumps.
- **Restore** (Backups tab → restore icon, or `backup.restore`) unpacks the
  tar back into the container and issues `SHUTDOWN NOSAVE`; the Swarm
  restart policy brings Redis back and it loads the restored files from
  disk. When an AOF is present Redis replays it preferentially over the RDB,
  which is exactly what you want — both are restored from the same snapshot.
