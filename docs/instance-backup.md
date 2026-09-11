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
| Database dump | `<prefix>/web-server/<timestamp>.gz` | `pg_dump --clean --if-exists --no-owner --no-privileges` of the `DATABASE_URL` database (gzipped SQL) |
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

The order matters. `install.sh` boots the panel, and the panel runs its
migrations on first start — so by the time you get a login screen the database
already has every table. Dumps are taken with `--clean --if-exists`, which
drops each object before recreating it, so restoring **over** that migrated
database is fine. Restoring a dump taken before v0.2.0 (without those flags)
onto a migrated database fails at the first `CREATE TABLE`; drop and recreate
the database first in that case.

1. **Fetch the artifacts** from your destination (replace prefix/timestamps),
   and make sure you also have your own copy of the old `.env` — it is
   deliberately **not** in the backup.

   ```bash
   # S3 destination:
   aws s3 cp s3://<bucket>/backup/web-server/<ts>.gz dump.sql.gz
   aws s3 cp s3://<bucket>/backup/web-server-config/<ts>.gz config.tar.gz

   # local destination — copy them off the OLD host first:
   # <config dir>/backups/<organizationId>/backup/web-server/<ts>.gz
   # <config dir>/backups/<organizationId>/backup/web-server-config/<ts>.gz
   ```

2. **Rehearse the restore before you touch the new host.** Ten minutes now,
   on any machine with Docker, beats finding out mid-incident:

   ```bash
   ./tools/dr-restore-test.sh --dump dump.sql.gz
   ```

   It restores into a throwaway Postgres container, restores a **second**
   time to prove `--clean --if-exists` works over a populated database,
   asserts the core tables and prints their row counts, then removes the
   container. `--boot` additionally starts the panel image against the
   restored database and waits for `GET /api/ready`.

3. **Provision the new host.** Install Docker, then install Nixploy per
   [install.md](./install.md) and **stop before logging in**.

4. **Put the old `.env` back** at `/etc/nixploy/.env`, mode 600. The instance
   must run with the **same** `ENCRYPTION_KEY` (and ideally
   `BETTER_AUTH_SECRET`) as the old one; otherwise every encrypted column
   (env vars, credentials, S3/notification configs) is unreadable after the
   restore and has to be re-entered. `DATABASE_URL` / `POSTGRES_PASSWORD`
   must match the Postgres you restore into — keep the installer's fresh
   values if you let it create Postgres, and change only the auth secrets.

   **Restoring to a new IP or domain?** Set `BETTER_AUTH_URL` in the restored
   `.env` to the address you will actually browse to, or every sign-in fails
   with "Invalid origin". Then either re-run
   `NIXPLOY_DOMAIN=panel.new.example sudo -E bash install.sh`, or edit the
   file and `docker service update --env-add BETTER_AUTH_URL=… nixploy`.
   Also update the dashboard domain under Settings → Platform once you are
   in, and point the DNS A record at the new host **before** Let's Encrypt
   is asked for a certificate.

5. **Restore the database.** The dump is plain SQL:

   ```bash
   gunzip -c dump.sql.gz | docker exec -i "$(docker ps -qf name=nixploy-postgres)" \
     psql -U nixploy -d nixploy -v ON_ERROR_STOP=1
   ```

   `ON_ERROR_STOP=1` is deliberate: a restore that logs errors and continues
   leaves a half-populated database that looks like it worked.

6. **Restore the config directory** (default `/etc/nixploy`, or wherever
   `NIXPLOY_CONFIG_DIR` points). Keep the `.env` you placed in step 4 — the
   archive does not contain one, so nothing overwrites it:

   ```bash
   mkdir -p /etc/nixploy
   tar xzf config.tar.gz -C /etc/nixploy
   chmod 600 /etc/nixploy/traefik/acme.json    # tar can widen the mode
   ```

7. **Recreate the platform services** — re-run `install.sh` (or
   `docker service update --force nixploy` + `nixploy-traefik`) so the panel
   picks up the restored `.env` and Traefik reloads the restored dynamic
   configs and certificates.

8. **Verify** before declaring the restore done:

   ```bash
   curl -sk https://<new-host>/api/ready | jq        # every check ok
   ```

   - Sign in. If the login page rejects the origin, `BETTER_AUTH_URL` is
     wrong (step 4).
   - Open a service's **Environment** tab. Values showing as garbage, or
     decryption errors in `docker service logs nixploy`, mean the
     `ENCRYPTION_KEY` in `.env` is not the original one — stop and find the
     right key rather than re-entering secrets.
   - Check projects, domains and backup destinations are all present.

9. **Redeploy affected services** as needed — the database knows about them,
   and container state is reconciled automatically for services whose images
   still exist in the registry.

## Disaster-recovery checklist

Fill this in for your install and keep it **outside** the machine it
describes.

### Objectives

| | Value | Determined by |
| --- | --- | --- |
| **RPO** (data you can afford to lose) | = your instance-backup interval | the cron on the instance backup row. Nightly ⇒ up to 24 h of projects, domains, env changes and deploy history |
| **RTO** (time to be serving again) | ≈ 20–40 min on a prepared host | provision + install (10–15 min) + restore (minutes for a typical dump) + redeploy the services you need |

Deployed **workloads** are not in the dump. They are rebuilt or re-pulled
after the restore, so a large fleet's real RTO is dominated by redeploys, not
by the database.

### What must exist off-box

| Item | Where it lives | Notes |
| --- | --- | --- |
| Database dump | destination bucket, `<prefix>/web-server/` | the panel's whole state |
| Config archive | destination bucket, `<prefix>/web-server-config/` | Traefik config + `acme.json` + SSH keys |
| **`/etc/nixploy/.env`** | **somewhere else entirely** | password manager / KMS / offline vault. **Never the same bucket as the dump** — it holds the key that decrypts it |
| Application source | your Git host | Nixploy stores references, not code |
| Images built in-panel | a registry, if you cannot rebuild | locally built images live only on the host |
| Named volumes | separate volume backups | not part of the instance backup |
| DNS control | your registrar | to repoint records at the new host |

A "local" destination is on the panel host's own disk: **a lost host takes
those backups with it.** Use S3 (or copy them off with `rsync`/snapshots) for
anything you actually rely on.

### Key custody

`ENCRYPTION_KEY` is the single point of failure. Without it the dump is
useless for every stored credential.

- Store it separately from the backups, with at least two people or two
  locations able to reach it.
- Treat a rotation as a migration, not a config change — everything encrypted
  with the old key has to be re-encrypted first.
- `BETTER_AUTH_SECRET` is less critical (losing it only invalidates existing
  sessions); `POSTGRES_PASSWORD` / `DATABASE_URL` only need to match the
  Postgres you restore into.

### Rehearse

The first real restore should not be the first restore.

```bash
sudo ./tools/dr-restore-test.sh                        # newest local dump
./tools/dr-restore-test.sh --dump dump.sql.gz --boot   # a fetched artifact + panel boot
```

Run it on a schedule (monthly is a reasonable floor), after any Postgres major
upgrade, and after changing the backup destination. Also use the in-app
**Verify** button (see above) on individual runs — it proves a stored dump
restores into a throwaway container, from the UI, with no shell access.

### Drill checklist

- [ ] Both artifacts downloadable from the destination, by someone who is not
      the person who set it up
- [ ] `.env` retrievable from its separate location
- [ ] `tools/dr-restore-test.sh` passes on the newest dump
- [ ] A scratch host restored end to end at least once, with a real sign-in
- [ ] DNS TTLs low enough to repoint quickly (≤ 300 s before a planned move)
- [ ] The checklist itself stored off-box

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
