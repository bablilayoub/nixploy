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

S3 endpoints must resolve to public addresses unless the instance admin enables
**Settings → Platform → Outbound requests → Allow private network targets**
(`allowPrivateEgress`). Self-hosted S3 on a LAN or loopback address needs that
setting, including destinations created before this guard was added. The Swarm
overlay (`10.0.0.0/8`), platform service names and cloud metadata endpoints stay
blocked even when the setting is on, including through DNS aliases. Endpoint
checks apply when connecting, so a saved destination can fail after the setting
is disabled or its DNS answers change. Use **Test connection** before the next
backup after changing the endpoint, DNS or egress setting.

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

These are separate recovery layers:

| Backup | Recovers | Still needed |
| --- | --- | --- |
| Instance | Panel users/orgs, service definitions, credentials, domains; config archive: routing/TLS/SSH files | Separate encryption/auth keys, workload data, source/images and runtime services |
| Managed database | One logical SQL/Mongo database, or Redis persistence snapshot | Matching database engine, credentials and service definition; application files/volumes |
| Named volume | Files in one named Docker volume | Service definition, correct target server/volume name, coordinated database snapshot when needed |

The config archive includes everything under the config dir **except**
derived/heavy subtrees (`applications/`, `compose/`, `logs/`, `metrics/`,
`runtime-logs/`, `cache/`, `backups/`, `tools/`, `files/`) and the panel's own
secrets file (`.env`, plus any `.env.*` copy). What remains is the state an instance restore actually
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
without the keys used by the dump cannot decrypt its encrypted values**:
env vars, database passwords, registry/git/SSH credentials, S3 keys and
notification configs are unrecoverable, and every service must be
re-configured by hand. Preserve the complete `ENCRYPTION_KEYS` chain when
configured; it takes precedence over the single `ENCRYPTION_KEY`. A historical
dump may still need an old key removed after a later rotation.

Keep **`BETTER_AUTH_SECRET` too**: better-auth uses it to encrypt TOTP secrets
and recovery codes, as well as to sign sessions. Replacing it invalidates
sessions **and prevents existing TOTP/recovery-code authentication**.
`POSTGRES_PASSWORD`/`DATABASE_URL` only need to match the Postgres you restore
into. Passkeys also require their original relying-party hostname; moving to
a different panel domain can require a password/TOTP sign-in and re-enrolment.

> **Sensitivity:** the dump contains all tenants' data (secrets are encrypted
> at rest, but readable with your `ENCRYPTION_KEY`), and the archive contains
> TLS private keys and SSH private keys in plain text. Point instance backups
> at a private bucket with tight IAM.

Instance retention (`keepLatestCount`) prunes matching timestamp pairs after
both new artifacts are stored. Config is published first and its SQL sibling
last; a published SQL key advertises a complete pair. Failed publication
attempts cleanup, but storage failure can prevent removal: there is no atomic
two-object transaction. Fetch the SQL and config archive from the same
completed run; a SQL-only verification does not verify its config companion.
Instance backups can only be created, edited or run by
the **instance admin** (the first user), never by an org admin — the dump
contains every tenant.

Every dump pipeline captures the producer's exit status (a failed `pg_dump`
or `tar` fails the run instead of uploading an empty archive) and rejects
gzip files that decompress to zero bytes. Restores stream the archive over
stdin, so large dumps are not limited by the shell's argument size.

Database, instance, volume and Redis backup producers stream binary gzip into
the destination: S3 uses 8 MiB multipart uploads, local storage uses a `0600`
temporary file followed by rename. Producer failure prevents finalization and
retention, and full gzip integrity is checked before publication. Archives no
longer pass through the base64/50 MB command buffer.
Local backup files are excluded from config archives so later instance runs
do not recursively include earlier backups.

Before a restore or verification touches the target, the selected object is
downloaded once into a private temporary cache, its full gzip integrity is
checked, and those same bytes are replayed. Tar archives also pass a target-side
readability/path check without mounting the target volume. Confined relative
links are supported; escaping links and special files require manual recovery.
The cache is removed afterward, including on failure.
Provision free scratch disk for the compressed archive and, for volume
replacement, space for both staged restored files and the previous contents.
Volume backups do not pause application writes: coordinate application/database
snapshots when consistency requires it.

Volume archives and volume/Redis replacements share `.nixploy-restore-lock/`
at the target volume root. The archive reader mounts the data read-only and
excludes only its own root marker; the fence remains active until that reader
has stopped and its identity has been checked. Failed backup preparation does
not publish or prune archives. Replacements acquire the same fence before staging. Its `owner` file records a random operation token;
the filesystem lock fences other panel/worker processes, including restores
through another database or managed-server connection. Existing locks or
`.nixploy-restore-*` / `.nixploy-previous-*` recovery trees block another
backup or restore. They have no expiry and are never automatically treated as stale.
A crash, a detached helper or a failed rollback can leave them behind. Keep
the service stopped, prove that no restore helper or other volume writer is
active on the exact server and volume, then inspect the matching staged and
previous trees and complete recovery manually. Preserve those trees until
the intended data is safely restored; remove the lock only after recovery
and helper shutdown are confirmed. Removing a marker alone is not recovery.

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

2. **Rehearse the SQL restore before you touch the new host.** Ten minutes now,
   on any machine with Docker, beats finding out mid-incident:

   ```bash
   ./tools/dr-restore-test.sh --dump dump.sql.gz
   ```

   It restores into a throwaway Postgres container, restores a **second**
   time to prove `--clean --if-exists` works over a populated database,
   asserts the core tables and prints their row counts, then removes the
   container. It checks SQL restoreability and table presence, not whether
   the expected users, secrets, config or workload data survived. Zero users
   produces a warning, not proof of recovery.

   `--boot` additionally requires panel readiness against the scratch database:

   ```bash
   ./tools/dr-restore-test.sh --dump dump.sql.gz --boot \
     --panel-image ghcr.io/nixploy/nixploy:<matching-release> \
     --recovery-env /secure/recovery.keys \
     --docker-socket /path/to/disposable/docker.sock
   ```

   Use a disposable Docker daemon/context for the drill. The explicit socket
   path is on that daemon's host and is mounted for the real readiness Docker
   check; **never supply the production socket**. A read-only socket mount
   does not make the Docker API read-only. The scratch panel uses role `panel`
   (no worker or cron jobs) and a private internal network. It probes
   `http://127.0.0.1:3000/api/ready` with `docker exec` inside the panel
   container; the panel has no published host port. Internal Docker networks
   may also prevent host access to the scratch Postgres port. With `--keep`,
   inspect either container through `docker exec` rather than a host URL.
   It does not restore config or run migrations; use an image matching the
   dump's schema. Missing inputs, container-start failures and readiness
   failures make `--boot` fail.

   `/secure/recovery.keys` must be a separate, mode-600 **Docker-format** file
   with only the recovered values, entered from the secret vault:

   ```dotenv
   ENCRYPTION_KEYS=<new-key>,<old-key>
   BETTER_AUTH_SECRET=<original-auth-secret>
   ```

   Use `ENCRYPTION_KEY=<original-key>` instead when the instance never used a
   chain. Values are **unquoted**, with no `export` or shell commands. Docker
   `--env-file` preserves shell quotes as part of the value, so copying an
   arbitrary shell `.env` can change a key. The script rejects quoted entries
   and does not source the file. A green readiness result still does **not**
   prove the keys decrypt data or that sign-in works; test those separately.

3. **Provision and quiesce the new host.** Install Docker, then install Nixploy
   per [install.md](./install.md) and **stop before logging in**. Stop the
   target panel and any split worker before replacing their database/config:

   ```bash
   docker service scale nixploy=0
   if docker service inspect nixploy-worker >/dev/null 2>&1; then
     docker service scale nixploy-worker=0
   fi
   ```

   Run these commands only on the recovery host. Neither the worker nor
   role `all` may claim restored queued deployments or run schedules while
   storage and keys are being recovered.

4. **Put the old `.env` back** at `/etc/nixploy/.env`, mode 600. The instance
   must run with the old **complete encryption key chain** (`ENCRYPTION_KEYS`,
   or `ENCRYPTION_KEY` for a single key) and **`BETTER_AUTH_SECRET`**; otherwise
   encrypted values (env vars, credentials, S3/notification configs) and TOTP
   authentication cannot be recovered. `DATABASE_URL` / `POSTGRES_PASSWORD`
   must match the Postgres you restore into — keep the installer's fresh
   values if you let it create Postgres, and change only the auth secrets.

   **Restoring to a new IP or domain?** Set `BETTER_AUTH_URL` in the restored
   `.env` to the address you will actually browse to, or every sign-in fails
   with "Invalid origin". Edit the file before recreating the platform
   services in step 8, retaining the new domain/IP installer options.
   Also update the dashboard domain under Settings → Platform once you are
   in, and point the DNS A record at the new host **before** Let's Encrypt
   is asked for a certificate.

5. **Validate both artifacts, then restore the database.** Verify any
   independently recorded checksums first. Gzip/tar validity alone does not
   authenticate an archive; use artifacts from your trusted backup destination.
   In Bash, require both sides of the pipeline and the SQL transaction to succeed:

   ```bash
   set -euo pipefail
   gzip -t dump.sql.gz
   gzip -t config.tar.gz
   tar -tzf config.tar.gz > config.contents
   tar -tvzf config.tar.gz > config.details
   # Reject absolute/traversal paths and any attempt to replace the secrets file.
   awk '{ while (sub(/^\.\//, "")) {}; if ($0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\.env([.\/]|$)/) bad=1 } END { exit bad }' config.contents
   # Normal config backups contain regular files/directories. Inspect any
   # archive with links or special files manually; do not extract it as root.
   awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' config.details
   pg_container="$(docker ps -qf label=com.docker.swarm.service.name=nixploy-postgres)"
   test "$(printf '%s\n' "$pg_container" | wc -l)" -eq 1
   test -n "$pg_container"
   gunzip -c dump.sql.gz | docker exec -i "$pg_container" \
     psql -U nixploy -d nixploy --single-transaction -v ON_ERROR_STOP=1
   ```

   `ON_ERROR_STOP=1` stops on the first SQL error; `--single-transaction`
   rolls back that SQL restore on failure. Do not continue after a failed
   validation or restore. Keep the original artifacts unchanged.

6. **Restore the config directory** (default `/etc/nixploy`, or wherever
   `NIXPLOY_CONFIG_DIR` points). Keep the `.env` you placed in step 4 — the
   archive must not contain one. Extract into a fresh staging directory,
   inspect it, and only then copy into the stopped target's config directory:

   ```bash
   restore_stage="$(mktemp -d)"
   chmod 700 "$restore_stage"
   tar xzf config.tar.gz --no-same-owner --no-same-permissions -C "$restore_stage"
   # Inspect "$restore_stage" before copying; never copy a .env from an archive.
   cp -a "$restore_stage/." /etc/nixploy/
   chmod 600 /etc/nixploy/.env
   if [ -f /etc/nixploy/traefik/acme.json ]; then
     chmod 600 /etc/nixploy/traefik/acme.json
   fi
   rm -rf "$restore_stage"
   ```

7. **Restore workload data separately.** The instance dump contains service
   definitions, domains, memberships and encrypted credentials; it contains
   neither managed database contents nor named-volume data. Restore logical
   database dumps into the matching database engine and version, and volume
   archives into **stopped volumes** on the correct service's server. Prefer
   fresh volumes for a cold restore. The runner refuses active writers and
   stages the full replacement before changing existing contents; files absent
   from the archive are removed. It preserves the old tree during the swap
   and attempts rollback on a replacement failure. If rollback itself fails,
   remaining prior/staged directories are retained and the error identifies
   their paths for manual recovery.
   This is not a guarantee against every disk or host failure. Services remain
   stopped; only restart after verifying the restored data.

   Git sources must remain accessible, and images built only on the lost host
   must be rebuilt or recovered from a registry. Uploaded source files under
   `files/` are excluded from the config backup. A restored route alone cannot
   recreate a missing workload or its data.

8. **Apply the recovered environment to both stopped platform services.** Editing
   `.env` and using `docker service update --force` does **not** update a
   service's stored environment. Re-running the installer on existing services
   also does not refresh encryption/auth secrets. Use the dedicated, unquoted
   recovery keys file from step 2; never source an arbitrary `.env`.
   Docker's `--env-add KEY` reads the value from the calling environment
   ([Docker CLI validator](https://github.com/docker/cli/blob/master/opts/env.go)),
   so secret values need not appear on its command line:

   ```bash
   (
     set -eu
     set +x                     # Never trace recovered values.
     unset ENCRYPTION_KEYS ENCRYPTION_KEY BETTER_AUTH_SECRET
     recovery_names=" "
     recovery_args=(--env-rm ENCRYPTION_KEYS --env-rm ENCRYPTION_KEY --env-rm BETTER_AUTH_SECRET)
     while IFS='=' read -r key value || [ -n "$key" ]; do
       case "$key" in
         ''|\#*) continue ;;
         ENCRYPTION_KEYS|ENCRYPTION_KEY|BETTER_AUTH_SECRET) ;;
         *) echo 'Unexpected recovery file entry' >&2; exit 1 ;;
       esac
       # Literal Docker-format values only, no surrounding shell quotes.
       [[ -n "$value" && "$value" != \"* && "$value" != \'* && "$value" != *\" && "$value" != *\' && "$value" != *$'\r'* ]] \
         || { echo 'Recovery values must be nonempty and unquoted' >&2; exit 1; }
       [[ "$recovery_names" != *" $key "* ]] \
         || { echo 'Duplicate recovery key' >&2; exit 1; }
       recovery_names+="$key "
       export "$key=$value"     # Assignment only: no eval or shell execution.
       recovery_args+=(--env-add "$key")
     done < /secure/recovery.keys
     test -n "${BETTER_AUTH_SECRET:-}" \
       || { echo 'Missing recovered auth secret' >&2; exit 1; }
     test -n "${ENCRYPTION_KEYS:-}${ENCRYPTION_KEY:-}" \
       || { echo 'Missing recovered encryption keys' >&2; exit 1; }
     for service in nixploy nixploy-worker; do
       if docker service inspect "$service" >/dev/null 2>&1; then
         docker service update --detach --replicas 0 "${recovery_args[@]}" "$service"
       elif [ "$service" = nixploy ]; then
         echo 'Recovery panel service is missing' >&2; exit 1
       fi
     done
   )
   ```

   Run the block from the `set -euo pipefail` shell above. It replaces stale
   encryption settings, retains both services at zero replicas, and leaves
   the recovery database connection untouched. Keep the same recovered values
   in the separately protected `.env` for future service creation. If the panel
   address changed, explicitly apply `BETTER_AUTH_URL` to both services too.
   Confirm their stored environments contain the recovered chain/auth secret
   without printing values. Do not remove `nixploy-postgres` or its data volume.

   **Start the worker only after workload data is ready and queued
   deployments/schedules have been reviewed.** A split install can start just
   the panel with `docker service scale nixploy=1` while the worker stays at
   zero; a single-process `nixploy` service includes the worker. Restore its
   original replica count only when ready. Restart Traefik after its config
   and certificates are restored.

9. **Verify** before declaring the restore done:

   ```bash
   curl -sk https://<new-host>/api/ready | jq        # every check ok
   ```

   - Sign in using a restored account, including TOTP/recovery code if enabled,
     and verify organization membership and project access. If the login page
     rejects the origin, `BETTER_AUTH_URL` is wrong (step 4).
   - Open a service's **Environment** tab. Values showing as garbage, or
     decryption errors in `docker service logs nixploy`, mean the
     encryption key chain is incomplete or wrong — stop and find the missing
     keys rather than re-entering secrets.
   - Verify decrypted env, database and backup-destination credentials match
     known fixture values without logging them. `/api/ready` does not check
     decryptability or the correctness of the encryption keys.
   - Check projects, domains and backup destinations are all present.
   - Compare restored logical database rows and named-volume file hashes with
     recorded values, then request an actual workload through its restored
     domain. A healthy panel is not proof of workload recovery.

10. **Redeploy recovered services** as needed after their data is ready. The
    status reconciler observes runtime state; it does not recreate a lost
    Swarm service, image or volume. Point DNS to the recovery host only after
    the restored routes serve the expected workload and data.

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

The keys needed by each dump are a recovery dependency. Without them its
encrypted credentials cannot be recovered.

- Store the complete `ENCRYPTION_KEYS` chain (or single `ENCRYPTION_KEY`)
  separately from the backups, with at least two people or two
  locations able to reach it.
- A rotation re-encrypts the live database, not historical dumps. Retain old
  keys for as long as a retained dump needs them, even after removing those
  keys from the live instance's chain.
- Preserve `BETTER_AUTH_SECRET`: losing it invalidates sessions and makes
  stored TOTP secrets and encrypted recovery codes unreadable.
  `POSTGRES_PASSWORD` / `DATABASE_URL` only need to match the recovery Postgres.

### Rehearse

The first real restore should not be the first restore.

```bash
sudo ./tools/dr-restore-test.sh                        # newest local dump
./tools/dr-restore-test.sh --dump dump.sql.gz          # a fetched SQL artifact
# Add --boot with the explicit recovery-env/socket inputs described above.
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

- The runner temporarily disables automatic AOF rewrites, waits for any rewrite
  to finish, then executes `redis-cli BGSAVE` inside the container (falling back
  to a blocking `SAVE`), waits until `rdb_bgsave_in_progress` is `0` and
  verifies `rdb_last_bgsave_status: ok`.
- It then `docker cp`s the whole Redis data directory (`CONFIG GET dir`,
  usually `/data`) — that is `dump.rdb` **plus the AOF** (`appendonlydir/`)
  when `appendonly` is enabled — into a gzipped tar in the destination at
  `<prefix>/<appName>/<timestamp>.gz`, with the same retention semantics as
  SQL dumps.
- The original automatic-rewrite setting is restored even after a failed copy;
  a reset failure fails the run and prevents retention. Do not run a manual
  `BGREWRITEAOF` concurrently. With ongoing writes, this captures a recoverable
  AOF prefix rather than one atomic latest-write instant; quiesce writes when
  the application requires a coordinated snapshot.
- Backups of the same Redis service share a PostgreSQL session lock. Inside
  its task container, `/tmp/.nixploy-redis-backup/` privately records the run
  token and original rewrite setting (`previous`). Cleanup removes this marker
  only after restoring that setting; a crash or failed reset can leave it
  behind, and another backup refuses to proceed. For manual recovery, first
  stop overlapping backup jobs and prove no copy is active. Inspect `previous`
  privately on the exact Redis task, restore and verify that recorded value
  with authenticated `CONFIG SET auto-aof-rewrite-percentage`, then remove
  only that marker and retry. Never delete the marker first or assume the old
  value was `100`. A container restart can discard `/tmp`; verify the actual
  rewrite setting afterward even when the marker is gone.
- **Restore** (Backups tab → restore icon, or `backup.restore`) requires the
  managed Redis service to be stopped at zero replicas with no active volume
  writers. It validates the gzip and `data/` tar subtree, stages a replacement
  of the managed `/data` volume, and preserves the old contents during the
  swap. Files absent from the backup are removed, so a stale AOF cannot
  override a restored RDB. Replacement failure attempts rollback; a failed
  rollback retains the recovery directories and reports their paths.
- Redis stays stopped after restore. Verify the data and start it explicitly;
  Redis loads the restored persistence files at startup. Custom data layouts,
  escaping links and special files require manual recovery.
