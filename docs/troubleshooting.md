# Troubleshooting

Keyed by **symptom** — what you see, then what to check. For the env
reference see [install.md → Runtime environment](./install.md#runtime-environment);
for what changed in a release see [upgrade-notes.md](./upgrade-notes.md).

First two commands for almost everything:

```bash
curl -sk https://<panel-host>/api/ready | jq       # which check is failing
docker service logs --tail 100 nixploy            # why
```

`/api/ready` answers 503 with a `failing: [...]` list when the panel cannot
serve. Every section below names the check it corresponds to.

---

## Install

### "Ports 80 and 443 in use" / Traefik will not start

Something else owns the ports — usually nginx, Apache, Caddy or a previous
proxy.

```bash
ss -ltnp | grep -E ':(80|443)\s'     # who holds them
systemctl stop nginx && systemctl disable nginx
```

Then re-run `install.sh`. If you *want* to keep the other server in front,
skip the check with `NIXPLOY_SKIP_PORT_CHECK=1` and terminate TLS yourself —
but Traefik then has nothing to bind and Let's Encrypt HTTP-01 will fail.

On a re-run the check passes automatically: `nixploy-traefik` is allowed to
hold its own ports.

### `docker service create` fails immediately / "rootless"

```bash
docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}'
```

If that prints `rootless`, Nixploy cannot run: rootless Docker has no Swarm,
cannot bind privileged ports and cannot share `/var/run/docker.sock`. Install
Docker Engine as root and re-run.

### The setup URL shows a private IP, or sign-in says "Invalid origin"

`BETTER_AUTH_URL` must be exactly the origin you type in the browser.
NAT'd clouds put a private address on the NIC, so auto-detection can pick the
wrong one.

```bash
grep BETTER_AUTH_URL /etc/nixploy/.env
NIXPLOY_DOMAIN=panel.example.com sudo -E bash install.sh   # or NIXPLOY_PUBLIC_IP=…
```

---

## Updates

### The update rolled back

Swarm reverted to the previous image because the new task failed its
`HEALTHCHECK` (`GET /api/ready`) inside the 60 s monitor window.

```bash
docker service ps nixploy --no-trunc | head          # the failed task + its error
docker service logs --tail 100 nixploy               # the boot/migration error
```

The rollback restores the previous **image**, not the previous **database**.
If a migration half-applied, restore the dump `update.sh` took right before
the roll:

```bash
ls -lt /etc/nixploy/backups/pre-update-*.sql.gz | head
gunzip -c /etc/nixploy/backups/pre-update-<tag>-<ts>.sql.gz \
  | docker exec -i "$(docker ps -q -f label=com.docker.swarm.service.name=nixploy-postgres)" \
      psql -q -U nixploy -d nixploy
```

### Migration failure: `/api/ready` says `migrations.state: "behind"`

The panel is running code that expects newer tables than the database has —
the migration step did not complete. It answers 503 on purpose so Swarm does
not send traffic to it.

```bash
docker service logs nixploy 2>&1 | grep -i migrat | tail -20
```

Usual causes: Postgres was not up yet (the entrypoint waits
`NIXPLOY_DB_WAIT_SECONDS`, default 60 s — raise it on slow disks), the disk is
full, or a migration failed half-way. After fixing the cause, restart the task:
`docker service update --force nixploy`.

`migrations.state: "ahead"` is the opposite — old code on a newer schema,
i.e. a downgrade. That is a **warning**, not a failure; restore the matching
pre-update dump (above) or roll forward again.

### Deployments show "Interrupted" after an update

Expected, and bounded. Rolling the panel restarts the process; the deploy
queue lives in that process. SIGTERM waits `NIXPLOY_SHUTDOWN_GRACE_MS`
(default 60 s) for in-flight jobs, then cancels them, and boot recovery marks
anything still `running` as failed rather than leaving it hanging forever.

Nothing is corrupted — the container that was being built is simply not
deployed. Redeploy the affected services. To avoid it: the in-app updater
refuses to roll while deployments are running (Settings → Updates asks
"Update anyway"); `update.sh` does not, so run it when the queue is idle
(`curl -s …/api/ready | jq .checks.queue`).

### `update.sh` refuses: "Refusing to downgrade"

Migrations are forward-only. Restore the pre-update dump taken *before* the
version you are leaving, then re-run with `NIXPLOY_ALLOW_DOWNGRADE=1` and the
old `NIXPLOY_VERSION`.

---

## TLS and domains

### A domain with HTTPS off still redirects to https

An install from before v0.2.0 still has the entrypoint-level redirect in its
static config:

```bash
grep -A5 'address: ":80"' /etc/nixploy/traefik/traefik.yml
```

If it shows an `http.redirections` block, re-run `update.sh` — it re-renders
`traefik.yml` without it and restarts the proxy. By hand:

```bash
# delete the http: block under entryPoints.web, then
docker service update --force nixploy-traefik
```

Traefik reads its static config **once at start**; editing the file alone
changes nothing.

### Certificate stuck on the self-signed one / ACME never issues

In order of likelihood:

1. **No ACME email.** `grep email: /etc/nixploy/traefik/traefik.yml` — if it
   says `nixploy@localhost`, Let's Encrypt rejects it. Fix in Settings →
   Platform → Let's Encrypt email, or re-run with
   `NIXPLOY_LETSENCRYPT_EMAIL=…`.
2. **DNS does not point here.** `getent hosts <domain>` vs
   `curl -s https://api.ipify.org`.
3. **Port 80 unreachable from the internet.** HTTP-01 needs it. Check the
   firewall *and* the cloud security group.
4. **Rate limited.** Let's Encrypt allows 5 failed validations per hostname
   per hour and 50 certificates per registered domain per week. The error is
   in the Traefik log:
   `docker service logs nixploy-traefik 2>&1 | grep -i acme | tail -20`.
   Wait it out — retrying faster makes it worse. Use a staging-free approach:
   fix DNS first, *then* attach the domain.

### `acme.json` permission errors

Traefik refuses to use its storage unless it is mode 600:

```bash
ls -l /etc/nixploy/traefik/acme.json     # must be -rw------- root root
chmod 600 /etc/nixploy/traefik/acme.json
docker service update --force nixploy-traefik
```

Never restore `acme.json` with a permissive umask — a `tar xzf` as another
user is the usual way it breaks.

### Traefik returns 404 for a service that is running

A service joins `nixploy-network` **only while it has a domain**. Check both:

```bash
docker service inspect <appName> --format '{{json .Spec.TaskTemplate.Networks}}'
ls /etc/nixploy/traefik/dynamic/          # one <appName>.yml per routed service
```

Adding, editing or deleting a domain reconciles the attachment. If the YAML
is there but the network is not, re-save the domain.

---

## Networking between services

### App cannot reach another service by name

Since v0.2.0 each environment has its own overlay (`<env>-<id8>-net`), so a
service resolves **only services of its own environment**. Cross-environment
and cross-organisation DNS is intentionally gone.

- Same environment? Move the service, or duplicate the dependency.
- Talking to a managed database in another environment? Use its published
  external port, or put both in one environment.
- Verify: `docker network inspect <env>-<id8>-net --format '{{range .Services}}{{.Name}} {{end}}'`

### `ping` inside a container says "operation not permitted"

`NET_RAW` is dropped from every tenant container (container hardening). ICMP
is gone; TCP is not.

- **Uptime Kuma ICMP/ping monitors will not work.** Use HTTP(S) or TCP-port
  monitors instead.
- To test connectivity, use something that opens a socket:
  `nc -z <host> <port>`, `wget -qO- http://<host>:<port>`.
- `MKNOD`, `SETPCAP`, `AUDIT_WRITE` and the `SYS_*` capabilities are gone too.
  An image that needs one of them needs an instance-admin override.

### Panel cannot reach Postgres after an upgrade

```bash
docker service inspect nixploy --format '{{json .Spec.TaskTemplate.Networks}}'
```

It must list the `nixploy-internal` id. Re-run `update.sh` — the network
migration is idempotent and safe to repeat.

---

## Deployments

### Swarm tasks stay `Pending`

`docker service ps <appName> --no-trunc` prints the reason in the error
column. The three common ones:

| Message | Meaning |
| --- | --- |
| `no suitable node (insufficient resources…)` | The reservation does not fit. Lower the service's CPU/memory **reservation**, or the org quota that became its default |
| `no suitable node (scheduling constraints…)` | A placement constraint or a `swarm_node_id` pin points at a node that is gone. Clear it under Advanced → Placement |
| `no such image` | A locally built image was pruned. Deploy again to rebuild — never run `docker image prune -a` on a Nixploy host |

### A service suddenly got CPU/memory limits it never had

Org quotas `maxCpuShares` / `maxMemoryMb` are applied as **per-service
`Resources.Limits` defaults** when the service sets none. An operator who
set a small quota "as a guard rail" now caps every service in that org.
Settings → Organization → Quotas; `1024` shares = 1 CPU.

### Deploy never finishes

1. Application → Deployments → Logs — the build log is the truth.
2. Disk: `df -h /etc/nixploy` and `docker system df`. A full disk hangs
   builds long before it errors.
3. The queue: `curl -s …/api/ready | jq .checks.queue`. A `stuck` count above
   zero means rows have been `running` for more than 90 minutes.
4. Jobs are bounded: 60 min per deployment
   (`NIXPLOY_DEPLOY_TIMEOUT_MS`), 30 min per command
   (`NIXPLOY_COMMAND_TIMEOUT_MS`).

### Compose validation now rejects a file that used to work

The deny-list grew: `cgroup_parent`, unbounded/oversized `tmpfs`, a foreign
`logging.driver`, `pids_limit` > 4096, `nofile` > 1M, `deploy.mode: global`
and `deploy.placement` targeting `node.role == manager` are refused. The error
names the key. Remove it, or ask an instance admin — these are the keys that
let a stack escape its sandbox.

---

## Disk

### The host is filling up

```bash
df -h /etc/nixploy
docker system df                       # images / containers / volumes / build cache
du -sh /etc/nixploy/* | sort -h | tail
```

Usual suspects, in order: the BuildKit cache, dangling images from rebuilds,
`applications/` checkouts, `logs/`.

Safe to reclaim:

```bash
docker image prune -f          # dangling only
docker builder prune -af       # BuildKit cache
```

**Never `docker image prune -a`** on a Nixploy host: a stopped application is
scaled to zero, so its locally built `appName:latest` has no container and
"all unused" pruning deletes the only copy.

Automate it: set `NIXPLOY_DOCKER_CLEANUP_CRON` (e.g. `0 4 * * 0`) for a weekly
prune, and watch the `hostDisk` platform alert — it warns at 85 % and
escalates at 95 % (see [observability.md](./observability.md#platform-self-alerts)).

Retention already prunes deployment rows and build logs older than 30 days,
schedule output, and resolved incidents — hourly.

---

## Logs

### Reading `LOG_FORMAT=json` output

One JSON object per line: `{ts, level, subsystem, message, ...meta}`.

```bash
docker service logs nixploy 2>&1 | jq -c 'select(.level=="error")' | tail -20
docker service logs nixploy 2>&1 | jq -c 'select(.subsystem=="deploy")'
```

Without `jq`, see the Python one-liner in
[observability.md → Platform logs](./observability.md#platform-logs), which
also lists every subsystem prefix.

### `docker service logs` returns nothing

The panel reads logs through the Docker API, which needs the `json-file` or
`journald` driver. `install.sh` sets `json-file` with rotation on all three
platform services — if someone changed the daemon default, logs disappear
from both the CLI and the UI.

---

## Backups and restore

### "No instance backup has ever completed" alert

Exactly what it says: nothing can restore this instance. Settings → Backups →
Instance backups (instance admin only). Silence it with
`NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS=0` if you back up the volume out-of-band
instead — but then keep a copy of `/etc/nixploy/.env`, which is deliberately
**not** in any backup.

### A restore fails with "relation already exists"

The dump was taken without `--clean --if-exists` (pre-v0.2.0). Either drop and
recreate the database first, or re-dump. Rehearse before you need it:

```bash
sudo ./tools/dr-restore-test.sh            # newest dump, into a scratch container
./tools/dr-restore-test.sh --dump d.gz --boot
```

See [instance-backup.md](./instance-backup.md#disaster-recovery-checklist).

### Everything decrypts to garbage after a restore

`ENCRYPTION_KEY` does not match the one that wrote the data. It is in
`/etc/nixploy/.env`, which is **excluded from backups on purpose** — restore
your own copy of that file. Without the original key, every env var,
credential, registry/SSH secret and notification config has to be re-entered
by hand.

---

## Still stuck

Collect this before asking for help — it is what any answer will start from:

```bash
curl -s https://<host>/api/version
curl -sk https://<host>/api/ready | jq
docker service ls
docker service ps nixploy --no-trunc | head
docker service logs --tail 200 nixploy
df -h /etc/nixploy && docker system df
```

`nixploy doctor` (CLI) prints the first four in one go.
