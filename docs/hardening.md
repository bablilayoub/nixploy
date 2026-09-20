# Hardening: tenant networks and container defaults

What Nixploy does, by default, to keep one tenant's container away from another
tenant's data — and away from the panel itself. Nothing here is configurable
per organisation; the only escape hatches are instance-admin gated.

> The Phase 9 engineering checklist that used to live at this path is archived
> at [`archive/hardening.md`](./archive/hardening.md) — it is about indexes and
> file sizes, not about isolation.

## 1. Network model

Four kinds of overlay exist on the swarm. A service joins the ones its role
needs, and nothing else.

| Network | Driver | Who joins it | Why |
| --- | --- | --- | --- |
| `nixploy-internal` | overlay, attachable | `nixploy`, `nixploy-postgres`, `nixploy-traefik` | Panel ↔ platform Postgres, and Traefik → panel for the dashboard router. **No tenant workload ever joins it.** |
| `nixploy-network` (`NIXPLOY_NETWORK`) | overlay, attachable | `nixploy-traefik` + every tenant service that has **at least one domain** | The only place Traefik dials backends. A service with no route is not on it. |
| `<env-slug>-<env-id8>-net` | overlay, attachable | every application, database and compose service of **one environment** | Lets a tenant's own services resolve each other (`api` → `db-abc123`) without exposing them to other organisations. |
| `<appName>-net` | bridge (compose) / overlay (stack) | the services of one compose stack | Keeps bare stack names (`db`, `redis`) scoped to the stack. |

```
                          :80/:443
                             │
                    ┌────────▼─────────┐
                    │  nixploy-traefik │
                    └───┬──────────┬───┘
        nixploy-internal│          │nixploy-network
             ┌──────────▼──┐    ┌──▼──────────────────────────────┐
             │   nixploy   │    │  routed tenant services only    │
             │   (panel)   │    │  (app / compose with a domain)  │
             └──────┬──────┘    └──┬───────────────────────┬──────┘
                    │              │                       │
          ┌─────────▼──────┐   ┌───▼────────────────┐  ┌───▼────────────────┐
          │ nixploy-postgres│  │ production-a1b2-net│  │ staging-c3d4-net   │
          └────────────────┘   │  app · db · stack  │  │  app · db · stack  │
                               └────────────────────┘  └────────────────────┘
                                       org A                   org B
```

Consequences, in order of importance:

- A compromised tenant container **cannot resolve** `nixploy:3000` or
  `nixploy-postgres:5432`. Before this change it could, and only the panel's
  password separated it from the platform database.
- A tenant container cannot resolve another organisation's services. It can
  only see the services of its own environment.
- `X-Real-IP` / `X-Forwarded-For` spoofing against the panel from inside a
  container is gone with it: there is no route to the panel except through
  Traefik.
- A managed database **never** joins `nixploy-network`. The panel reaches it
  with `docker exec` (backups, restores, the terminal, verification queries),
  and its connection URL is only useful from the same environment.
- Traefik is on two networks and, deliberately, is **not** attached per app:
  `docker service update --network-add nixploy-traefik` recreates the Traefik
  task (measured: a fresh task id and a ~9 s convergence with host-published
  :80/:443, i.e. a proxy outage for every tenant). Attaching *apps* to the
  shared overlay costs one rolling update of that one app instead.

### When the attachment changes

Domains are added and removed long after the deploy that built the spec, so
`syncApplicationTraefik` reconciles the shared-network membership every time a
routing row changes: the first domain attaches `nixploy-network`, the last one
removed detaches it (`modules/application/service.ts`,
`syncApplicationSharedNetwork`). The environment overlay is created before
every deploy and removed after the last service of the environment is deleted
(`docker network rm` refuses a network that still has endpoints, which is
exactly the "only when empty" semantic).

### Naming and the reserved prefix

`nixploy-` is the platform namespace. Environment networks are named
`<slug>-<id8>-net` and an environment literally called "nixploy" is prefixed
with `env-`, so a tenant can never name a network into the platform namespace.
The `networkSwarm` override only accepts `nixploy-*` targets and is therefore
**instance-admin only**; the environment overlay and the domain-derived shared
attachment are computed, not configurable.

## 2. Container hardening defaults

Applied to every tenant workload — applications, managed databases, and (in
compose shape) compose stacks.

| Setting | Value | Why |
| --- | --- | --- |
| `CapabilityDrop` | `["ALL"]` | Docker's default set is ~14 capabilities wide. |
| `CapabilityAdd` | `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `KILL`, `NET_BIND_SERVICE`, `SETGID`, `SETUID` | Enough for `gosu`/`su-exec` entrypoints, chowning a fresh data volume and binding :80 inside the container. **`NET_RAW` is gone** — no ARP/DNS spoofing, and no `ping` from tenant containers. |
| `Privileges.NoNewPrivileges` | `true` | A setuid binary inside the container cannot regain capabilities. |
| `Resources.Limits.Pids` | `1024` | Fork-bomb ceiling. |
| `Ulimits` | `nofile` 65536 soft/hard | The one limit images routinely blow. |
| `LogDriver` | `json-file`, `max-size=10m`, `max-file=3` | An unbounded tenant log used to be able to fill the host disk; the platform's own services have had rotation since the installer was written. |
| `Resources.Limits.Memory/NanoCPUs` | org quota, when the service sets none | See below. |

Verified on a local swarm with `traefik/whoami`, `nginx:alpine`,
`postgres:17`, `mysql:9`, `mariadb:11`, `redis:8-alpine` and
`louislam/uptime-kuma` — all start, initialise their data dir and serve.

These keys are written **explicitly** on every deploy (never left `undefined`),
so a live spec that grew `Privileges` or `CapabilityAdd` from a manual
`docker service update` is reset on the next deploy instead of surviving the
spec merge.

### Quota-derived resource limits

`Settings → Organization → Quotas` has `Max CPU shares` and `Max memory (MB)`
(and, since 2026-09-20, the org's runtime log retention under the instance
ceiling — docs/observability.md).
They are now applied as **per-service `Resources.Limits` defaults** when the
service itself sets no limit; an explicit per-service value always wins.
`maxCpuShares` is read in Docker's own unit — **1024 shares = 1 CPU**, so
`2048` means "two cores per service" — with a 0.05 CPU floor so a mis-typed
quota cannot make a workload unbootable. Leave both empty for no default.

### Compose stacks

The compose safety deny-list (already covering `privileged`, host namespaces,
`security_opt`, dangerous `cap_add`, `devices`, `ports`, host binds, the Docker
socket and Traefik labels) gained:

| Key | Rule |
| --- | --- |
| `cgroup_parent` | rejected — it escapes every limit Nixploy sets |
| `tmpfs` (service-level) | must carry an explicit `size=`, at most `1g` (unbounded tmpfs is RAM) |
| `logging.driver` | `json-file` or `local` only |
| `pids_limit` | 1 – 4096 |
| `ulimits.nofile` | at most 1,000,000 |
| `deploy.mode: global` | rejected — it would run a task on every node |
| `deploy.placement.constraints` | may not target `node.role == manager` |

and the rendered file gets the hardening defaults injected wherever it does not
set them: `cap_drop: [ALL]` plus the minimal `cap_add` (merged with whatever
the file legitimately asked for), `security_opt: [no-new-privileges:true]`,
`pids_limit`, `ulimits.nofile` and a rotating `logging` block. `docker stack
deploy` silently ignores `security_opt`, `pids_limit` and `ulimits`, so those
three are only injected for the `docker-compose` runtime; stack files still get
`cap_drop`/`cap_add` and `logging`.

## 3. Database external ports

A managed database publishes **no** host port unless you set one. It does not
need one: everything in the same environment reaches it by service name, and
the panel uses `docker exec`.

Swarm's host-mode publish binds **every** interface — there is no
`127.0.0.1:`-only form for a service port — so an external port is a real
internet-facing listener. Rejected values: everything below 1024, the
well-known database ports (5432, 3306, 6379, 27017, 1433, 1521, 9200, 11211),
the Docker/Swarm control ports (2375/2376/2377, 4789, 7946), SSH/mail/NFS, and
the panel's own port (3000 or whatever `NIXPLOY_PORT`/`PORT` is set to).

If you do open one, firewall it at the host and keep the generated password.

## 4. Outbound requests (egress)

Everything the panel fetches on a tenant's behalf goes through one guard
(`packages/server/src/utils/public-url.ts`). Full policy and the toggle:
[auth.md § Outbound requests](./auth.md#outbound-requests-egress-policy).
The short version:

| Target | Reachable |
| --- | --- |
| Public addresses | always |
| `169.254/16`, multicast, `240/4`, `192.0.0/24`, `198.18/15`, TEST-NET, IPv6 link-local / documentation | never |
| `10.0.0.0/8` **as an IP literal** (the Swarm overlay) | never |
| A bare service name the org deployed (`my-gotify`) | always |
| `nixploy`, `nixploy-postgres`, `nixploy-traefik`, `traefik`, `postgres` | never |
| Other private / LAN / loopback | only with **Allow private egress** (instance admin, default off) |

The vetted address is what the socket dials, so DNS rebinding between the check
and the connect does not work. Transports with their own resolver (SMTP, git,
the AWS SDK) re-resolve and compare instead.

Two more egress limits live outside the guard:

- **Uptime probes** need `domains.manage` (not the softer `project.write`) and
  are capped per organization — `NIXPLOY_MAX_PROBES_PER_ORG`, default 50.
- **Image references** whose registry host is private (`10.0.1.5:5000/x`,
  `registry:5000/x`) are refused at pull time unless the application's
  registry row is `selfHosted` and its host matches. The *daemon* performs the
  pull, from its own network position, so this is not covered by the panel's
  own egress policy.

## 5. Build-time secrets

Build variables never travel on argv:

| Builder | Mechanism |
| --- | --- |
| nixpacks, railpack | 0600 env file on the target server, sourced with `set -a`; only the NAMES reach argv (`--env KEY`) |
| Cloud Native Buildpacks (`pack`) | `--env-file <0600 file>` |
| Dockerfile | secret-looking keys (`*PASS*`, `*SECRET*`, `*TOKEN*`, `*KEY*`, `*CREDENTIAL*`, `*AUTH*`, `*PRIVATE*`, `*SALT*`, `*SIGNATURE*`) become BuildKit `--secret`; the rest stay `--build-arg` |

Every file is written over stdin, `chmod 600`, and deleted when the build
finishes or throws.

A BuildKit secret is **not** an environment variable inside the build — the
Dockerfile has to mount it:

```dockerfile
RUN --mount=type=secret,id=NPM_TOKEN \
    NPM_TOKEN="$(cat /run/secrets/NPM_TOKEN)" npm ci
```

Unlike `--build-arg`, a mounted secret never appears in `docker history`.

## 6. File modes on the host

Artifacts written under `<config>` are `0600`: per-app Traefik YAML (basic-auth
bcrypt hashes, inlined TLS keys), materialised `file` mounts, pre-deploy and
build env files, SSH keys and host-key pins. Remote writes go through
`umask 077` + `chmod 600` before the atomic rename.

## 7. What is still open

- The panel process runs as root with the Docker socket; a socket-holding
  sidecar is the long-term fix (audit §3.15).
- Container exec / terminal / schedules land as the image's root user — there
  is no `--user` yet (audit §2.5).
- No seccomp or AppArmor profile beyond the engine defaults.
- The per-environment overlay isolates organisations, not services inside one
  environment: a tenant's own services can still reach each other by name, on
  purpose.

See [`audits/2026-09/security.md`](./audits/2026-09/security.md) §2.5 for the
full finding list this page closes.
