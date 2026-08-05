# Docker control center

`/dashboard/docker` gives full control of the Docker daemon — on the Nixploy
host or any managed server (selector in the header).

| Tab | Contents |
| --- | --- |
| Containers | Every container with state badge, uptime, ports. Actions: start, stop, restart, live logs (LogViewer), interactive terminal, remove (force, confirmed). Auto-refreshes every 10s. |
| Images | List with size/age, pull by reference, remove, prune dangling. |
| Swarm | Nodes (status, role, engine) with availability switch (active/pause/drain), and all swarm services with replica counts. |
| Networks | List with driver/scope; removal blocked for `bridge`, `host`, `none`, `ingress` and `nixploy-network`. |
| Volumes | List with mountpoints; remove (docker rejects in-use), prune unused (data-loss confirm). |
| System | Engine version/OS, `docker system df` disk usage, system prune (with/without volumes). |

## Server side

- Router: `packages/server/src/trpc/routers/docker.ts` (registered as
  `docker` in the root router). All commands run through the docker CLI with
  `--format '{{json .}}'` (one JSON object per line, parsed by
  `parseJsonLines`) via `execAsync` locally or `execAsyncRemote(serverId)` on
  managed servers.
- Reads need any org membership; **mutations require the admin role**
  (`assertOrgRole` in `modules/projects`, see `docs/audit.md`).
- Container logs/terminal reuse the existing `/ws/logs` and `/ws/terminal`
  endpoints — `resolveLocalContainer` falls back to container-name lookup,
  so any container name works, not just Nixploy `appName`s.
- Destructive actions (container remove, prunes) are written to the audit
  log.
