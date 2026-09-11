# Docker control center

`/dashboard/docker` gives full control of the Docker daemon — on the Nixploy
host or any managed server (selector in the header).

| Tab | Contents |
| --- | --- |
| Containers | Every container with state badge, uptime, ports. Actions: start, stop, restart, live logs (LogViewer), interactive terminal, remove (force, confirmed). Auto-refreshes every 10s. |
| Images | List with size/age, pull by reference, remove, prune dangling. |
| Swarm | Nodes (status, role, engine) with availability switch (active/pause/drain), and all swarm services with replica counts. |
| Networks | List with driver/scope; removal blocked for `bridge`, `host`, `none`, `ingress` and `nixploy-network`. |
| Volumes | List with mountpoints; remove (docker rejects in-use), prune unused named + anonymous volumes (skips `nixploy-postgres-data`). |
| System | Engine version/OS, `docker system df` disk usage, system prune (with/without volumes; volume pass also clears named unused). |

## Server side

- Router: `packages/server/src/trpc/routers/docker.ts` (registered as
  `docker` in the root router). All commands run through the docker CLI with
  `--format '{{json .}}'` (one JSON object per line, parsed by
  `parseJsonLines`) via `execAsync` locally or `execAsyncRemote(serverId)` on
  managed servers.
- Reads need any org membership; **mutations require the admin role**
  (`assertOrgRole` in `modules/projects`, see `docs/audit.md`).
- Cluster-wide procedures — `nodes`, `nodeUpdate`, `swarmServices`, system
  prune — require the **instance admin** even when a managed server is
  selected: every remote joins the primary Swarm, so a manager-role remote's
  engine is the whole cluster. On hosts that are not a Swarm manager the
  Swarm tab shows its "inactive" state instead of an error.
- Volume prune/remove never touch volumes owned by services: `<appName>-data`
  for every database row, `mounts.volumeName`, `<composeApp>_*` prefixes and
  any source mounted by a Swarm service (`modules/docker/prune.ts`). Those rows
  are returned with `protected: true`.
- Container logs/terminal reuse the existing `/ws/logs` and `/ws/terminal`
  endpoints — `resolveLocalContainer` falls back to container-name lookup,
  so any container name works, not just Nixploy `appName`s.
- Destructive actions (container remove, prunes) are written to the audit
  log.
- Joining a host to the primary Swarm (`server.setup`) and the `manager` role on
  `server.create` / `server.update` require the **instance admin** as well — a manager
  controls every tenant's services and even a worker runs other orgs' unpinned tasks as
  root. `servers.manage` still covers registering, editing and removing server rows. Every
  setup run is audited as `server.setup` with `{ swarmRole, result }`. See docs/auth.md
  "Instance admin".

## SSH transport

Everything the panel does on a managed server — shell commands, builds, the
Docker engine API, container logs and stats, backups — runs over **one pooled
SSH connection per server** (`packages/server/src/utils/ssh-pool.ts`). Before,
each of those opened its own TCP connection and key exchange, so ten servers
meant hundreds of handshakes a minute from the crons and the open dashboard
tabs alone.

How it works:

- **One connection per server, many channels.** Callers take a *lease* on one
  channel (`acquireSsh`) and release it when their channel closes. At most
  `NIXPLOY_SSH_MAX_CHANNELS` (default 8, below OpenSSH's `MaxSessions` of 10)
  run at once; further callers queue FIFO instead of opening a second
  connection.
- **Keepalive.** The connection probes every 15 s and gives up after three
  unanswered probes, so a silently dropped link is noticed instead of hanging a
  build. A connection with no channels closes itself after
  `NIXPLOY_SSH_IDLE_MS` (default 5 min) and is re-dialled on demand.
- **The Docker API rides the same connection.** `getDocker(serverId)` hands
  dockerode an HTTP agent whose sockets are `docker system dial-stdio` channels
  on the pool. (docker-modem's own `ssh://` support builds a fresh SSH client
  for *every* API call.)
- **Circuit breaker.** After `NIXPLOY_SSH_BREAKER_FAILURES` consecutive
  connection failures (default 3) the server is marked unreachable and further
  commands fail immediately for `NIXPLOY_SSH_BREAKER_MS` (default 5 min)
  instead of paying the connect timeout again. The message names the server and
  when Nixploy will retry:
  `Server "prod-1" is unreachable over SSH: 3 connection attempts failed. Nixploy retries in 4m 58s.`
  One successful connection closes the breaker; so does **Test connection** on
  the server page (`server.testConnection`) or re-running **Setup**.
- **Fan-out crons group by server.** The status reconciler probes a bounded
  number of servers in parallel (`NIXPLOY_FANOUT_CONCURRENCY`, default 4),
  skips servers whose breaker is open, gives each probe a 15 s budget and
  abandons a server's remaining rows after its first failure — one dead host no
  longer stretches the every-minute pass.

`server.transportState` returns the live view (pooled connection up, channels
in use, consecutive failures, retry time; `lastError` only for callers with
`servers.manage`). The pool is **process-local**, like the deploy queue's
slots — it describes what this panel process sees, not a stored column, and the
`server_status` column keeps its operator-set `active`/`inactive` meaning.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NIXPLOY_SSH_MAX_CHANNELS` | `8` | Concurrent channels per pooled connection |
| `NIXPLOY_SSH_IDLE_MS` | `300000` | Close an idle pooled connection after this |
| `NIXPLOY_SSH_CONNECT_TIMEOUT_MS` | `30000` | Handshake budget (was the per-command `readyTimeout`) |
| `NIXPLOY_SSH_BREAKER_FAILURES` | `3` | Consecutive connect failures before a server is marked unreachable |
| `NIXPLOY_SSH_BREAKER_MS` | `300000` | How long commands are short-circuited while the breaker is open |
| `NIXPLOY_FANOUT_CONCURRENCY` | `4` | Servers a cron pass talks to at once |

Per-command timeouts are unchanged: `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS` (30 min
default) still bounds each remote command, and a timeout now closes only that
channel — the other commands on the server keep running.

The interactive terminal (`/ws/terminal`) still opens a dedicated connection
for the session; everything else shares the pool.

## Server terminal

Settings → Servers → the terminal icon on a row opens a shell **on the host**
of a managed server, over SSH, as its configured user
(`/ws/server-terminal?serverId=…`, `packages/server/src/ws/server-terminal.ts`).

- **Remote servers only.** There is deliberately no terminal into the Nixploy
  host: the panel container runs as root with the Docker socket mounted, so a
  shell there is a shell over every tenant at once. Containers on the local
  host stay reachable through the Docker control center's container terminal.
- **Instance admin + `servers.manage`.** A managed server is a Swarm member
  that runs other organizations' unpinned tasks as root, so a host shell on it
  is platform-wide power — the same reasoning as `server.setup` and the Swarm
  tab. Both halves are required; the button is hidden without them and the
  socket refuses anyway.
- The host key is pinned exactly as every other SSH path
  (`verifyRemoteHostKey`, trust on first use under
  `<config>/ssh/pinned-hosts/`), so a swapped host closes the socket instead
  of handing you a stranger's prompt.
- Opening a session writes an audit row (`server.terminal.open` with the
  server id and name) **before** the connection is attempted — a refused
  handshake is exactly the attempt worth seeing. Keystrokes themselves are not
  recorded.
- The session closes after **30 minutes of inactivity** (any keystroke or
  resize resets the clock; output alone does not, so a forgotten `tail -f`
  still times out). Closing the dialog ends the SSH connection.
- The shell holds a **dedicated** SSH connection rather than a lease on the
  pooled one — an operator typing for an hour must not occupy one of the
  server's eight shared channels.

## Volume file browser

Volumes → **Browse** opens a file browser for one volume
(`volumeFiles.*`, `packages/server/src/modules/docker/volume-files.ts`).

Nixploy never mounts a tenant volume into its own filesystem. Every operation
runs a throwaway container that has the volume and nothing else:

```
docker run --rm --network none <hardening flags> -v <vol>:/data[:ro] \
  --entrypoint sh alpine -c '<script>'
```

`alpine` is the same toolbox image volume backups already use, `--network none`
means nothing in the volume can phone home, reads mount `:ro`, and the
hardening flags are the deploy-hook baseline (`cap-drop ALL` plus the seven
standard caps, `no-new-privileges`, a pids ceiling).

| Procedure | What it does |
| --- | --- |
| `volumeFiles.list` | Directory listing (type, size, mtime), at most 1000 entries |
| `volumeFiles.read` | One text file, ≤ 512 KiB; binary files are refused |
| `volumeFiles.write` | Create or overwrite a text file (payload over stdin, never argv) |
| `volumeFiles.delete` | Remove a file, or a directory and its contents |
| `volumeFiles.mkdir` | Create one directory whose parent exists |

Path confinement is enforced **twice**, because one check is not enough:

1. Before a command is built, `normalizeVolumePath` rejects `..` and `.`
   segments, NUL bytes, backslashes and over-long/over-deep paths, and folds
   everything to `/data/<clean path>`.
2. The container resolves the path with `realpath` and prints it as the first
   line of stdout; Node verifies that resolved path still starts with `/data`.
   This is the check that catches a **symlink inside the volume**
   (`ln -s /etc data/escape`) — a lexical check on the input never can.

Authorization is `docker.manage` **plus the instance admin**: volumes are
instance-level Docker resources and the local socket sees every organization's.
`nixploy-postgres-data` is refused outright — the panel's own database is not
a file browser target. Writes, deletes and folder creation are audited
(`docker.volume.file.write` / `.delete` / `.mkdir`) with the resolved path.

There is no upload and no download: bulk data in and out of a volume is what
`volumeBackup` is for, and deleting here is permanent — take a volume backup
first.
