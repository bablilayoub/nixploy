# MCP server (AI agents)

Nixploy exposes an [MCP](https://modelcontextprotocol.io) (Model Context
Protocol) server so AI agents — Claude Desktop, Cursor, and other MCP clients —
can inspect and operate your instance: list projects, services and databases,
read logs, deployments, environment variables, incidents and backups, and —
behind the same capability checks the panel uses — deploy, start, stop,
restart, roll back, edit environment variables, attach domains, run backups
and resolve incidents.

- **Endpoint:** `POST https://<your-nixploy-host>/api/mcp`
- **Transport:** [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)
  (stateless — no server-side sessions, plain JSON responses)
- **Auth:** `Authorization: Bearer <api-key>` (or `x-api-key: <api-key>`)

Every tool call is dispatched into the same tRPC routers the panel, REST API
and CLI use — org scoping, role/capability checks and audit logging apply
exactly as they do for any other API-key client.

> **Settings → Profile → Connect an agent (MCP)** renders the config for Claude
> Code, Cursor and Codex with this instance's own URL already filled in. The API
> key stays a placeholder there on purpose — those files usually live in a git
> repository.

## 1. Create an API key

In the panel: **Settings → Profile → API keys → Create**. Copy the key — it is
shown only once. See [api.md](./api.md) and [auth.md](./auth.md) for details.

The key acts as the owning user, capped by the key's **scope**: the effective
permission set is *scope ∩ owner capabilities*, so `remove_domain` needs both
`domains.manage` on the user and a scope that includes it. Give an agent the
narrowest scope that lets it do its job — `read` for an observer, `deploy` for
one that ships, `write` only when it must change configuration
(see [api.md](./api.md#scopes)).

A key bound to an organization always acts for that organization; an unbound
key picks one with `x-organization-id: <org-id>`, otherwise the user's first
membership is used.

## 2. Configure your client

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"nixploy": {
			"type": "http",
			"url": "https://nixploy.example.com/api/mcp",
			"headers": {
				"Authorization": "Bearer <your-api-key>"
			}
		}
	}
}
```

### Cursor

Edit `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
	"mcpServers": {
		"nixploy": {
			"type": "streamable-http",
			"url": "https://nixploy.example.com/api/mcp",
			"headers": {
				"Authorization": "Bearer <your-api-key>"
			}
		}
	}
}
```

### Smoke test with curl

```bash
NIXPLOY=https://nixploy.example.com
KEY=nxp_...

rpc() {
	curl -sS -X POST "$NIXPLOY/api/mcp" \
		-H "Authorization: Bearer $KEY" \
		-H "Content-Type: application/json" \
		-H "Accept: application/json, text/event-stream" \
		-d "$1"
}

# 1. handshake
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 2. what tools exist
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq -r '.result.tools[].name'

# 3. call one
rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}' \
	| jq -r '.result.content[0].text'
```

The transport is stateless, so every request stands alone — no session id is
returned by `initialize` and none is needed on later calls.

## 3. Tool reference

42 tools. All inputs are validated with zod; outputs are compact JSON. Every
call goes through `appRouter.createCaller`, so the capability listed below is
enforced by the router, not by the tool.

### Behaviour annotations

Every tool ships `title`, `readOnlyHint`, `destructiveHint` and
`idempotentHint` (`modules/mcp/annotations.ts`), so a host knows what to put a
confirmation dialog in front of and an agent knows what it can call while it is
only looking.

They are **declared by hand, one line per tool, and a test fails the build when
a tool ships without an entry.** Inferring them from a name would be cheaper
and occasionally wrong, and `readOnlyHint: true` on something that mutates is
how an agent stops production while it believes it is investigating.

- `destructiveHint: true` on `stop_service`, `remove_domain`,
  `rollback_deployment`, `cancel_deployment` and `delete_preview`. Broader than "deletes rows":
  stopping a service destroys no data and is still not something an agent
  should do unprompted.
- `idempotentHint: false` on the deploy tools — calling one twice queues two
  builds, so a retry after a timeout is not free.
- `openWorldHint` is deliberately unset. Its default is `true`, which is the
  honest answer for a PaaS: a deploy clones from a git host and pulls from a
  registry, and even a read reaches a Docker daemon.

### Task tools

Four tools answer in one call what an agent would otherwise write a loop for:

| Tool | Instead of |
| --- | --- |
| `deploy_and_wait` | `deploy_service` + polling `list_deployments`. Returns the outcome: failing step, log tail, URLs, live task counts. Waits up to 55 s; if `done` is false, call it again with the same `deploymentId` rather than deploying again. |
| `explain_last_failure` | finding the last failed deployment, reading its log, and asking Copilot separately. Reuses a cached explanation unless `force` is set, and degrades to the outcome alone when Copilot is not configured. |
| `get_service_runtime_summary` | five calls: status, Swarm task counts, domains, recent deployments and recent timeline events. |
| `get_service_events` | guessing. The service event timeline is what answers *why did it restart?* — the deployment list only knows about deploys. |

### Prompts

Two investigation plans, listed under `prompts/list`:

- `troubleshoot_service` — runtime summary, then the timeline, then logs, in
  the order that answers fastest. It explicitly tells the agent not to deploy,
  restart, stop or roll back while investigating.
- `explain_failed_deploy` — the failing step and what changed around it.

A prompt grants nothing: everything it suggests still goes through the tools,
which go through the routers.

### Resources

- `nixploy://service/{applicationId}` — a service's state and last events, JSON.
- `nixploy://deployment/{deploymentId}/log` — a build log, truncated to its tail.

Neither template lists its members. Enumerating every service and deployment of
an organization is a lot of payload for something a host renders as a picker,
and the tools already answer "what is there" with pagination and filters.

### Read-only

| Tool | What it does | tRPC procedure |
| --- | --- | --- |
| `list_projects` | Projects of the caller's org, with environments and service counts | `project.all` |
| `list_services` | Every service of a project (applications, compose, databases) with status and `appName` | `project.one` |
| `list_databases` | Database services of a project across all five engines | `<engine>.all` |
| `get_database` | One database's configuration plus its live container status | `<engine>.one` + `getStatus` |
| `get_service_logs` | Build/deploy log of a service (latest deployment, or a given `deploymentId`), capped to the last 16k chars | `deployment.getLogs` |
| `get_preview` | One preview deployment: ref, status, hosts, expiry, the pull request it belongs to | `previewDeployment.one` |
| `get_runtime_logs` | Runtime log history — what a service printed, kept by the worker past the container's lifetime; terms, `"phrases"`, `-excludes`, `level:error`, `container:web`, `/regex/`; newest first, paged by `before` | `observability.runtimeLogs` |
| `list_deployments` | Recent deployments of one service with status and duration | `deployment.byApplication` / `byCompose` |
| `get_deployment_provenance` | Commit SHA, message, author, trigger and who triggered each recent deployment | `deployment.byApplication` / `byCompose` |
| `list_rollback_points` | Image pins kept per application (5 most recent) | `rollback.all` |
| `list_domains` | Domains of an application, compose service, or project | `domain.all` |
| `get_domain_diagnosis` | Why a host answers 502/404/nothing: DNS, route file, conflicting file, upstream task, shared network, port, Traefik's own answer, certificate — each with the fix | `domain.diagnose` |
| `list_previews` | Pull-request previews of an application with PR metadata and expiry | `previewDeployment.byApplication` |
| `get_env` | Variables at one scope (organization / project / environment / service) | `organization.environment`, `project.one`, `environment.byProject`, `<router>.one` |
| `get_resolved_env` | The merged org → project → environment → service view with each key's origin | `project.getResolvedEnvironment` |
| `list_incidents` | Alert firings, deploy-failure streaks, watchdog events, uptime flips | `observability.incidents` |
| `list_backups` | Backup schedules of a database (or of the instance) with their last run | `backup.all` |
| `list_backup_runs` | Run history: status, trigger, size, object key, error | `backup.runs` |
| `get_service_metrics` | CPU/memory per replica, by `appName` — local **and** remote nodes | `monitoring.replicaStats` (+ `fleetOverview` fallback) |
| `get_platform_health` | Database, Docker, migrations, queue depth, Traefik, version | `/api/ready` internals |
| `list_templates` | One-click template catalog | `template.all` |
| `list_template_sources` | The organization's remote catalogs with their last sync report | `template.sourcesList` |

### Guarded writes

Each needs the capability in the last column; without it the tool answers
`FORBIDDEN` and nothing changes.

| Tool | What it does | tRPC procedure | Capability |
| --- | --- | --- | --- |
| `deploy_service` | Queue a fresh build + rollout of an application | `application.deploy` | `service.deploy` |
| `create_preview` | An ephemeral copy of an application or compose stack from a branch, tag or sha (`ref`) or a pull request (`pullRequestNumber`), routed at its own wildcard host; returns the `deploymentId` to wait on | `previewDeployment.create` |
| `delete_preview` | Tear a preview down (variant service or project, routes, rows) | `previewDeployment.delete` |
| `deploy_compose` | Render, validate and apply a compose stack (recreates its containers) | `compose.deploy` | `service.deploy` |
| `rollback_deployment` | Redeploy from a stored image pin — does not rebuild or undo migrations | `application.rollback` | `service.deploy` |
| `cancel_deployment` | Kill a queued or running deployment | `application.cancelDeployment` | `service.deploy` |
| `stop_service` | Scale the Swarm service to 0 | `application.stop` | `service.runtime` |
| `start_service` | Scale back to the configured replica count | `application.start` | `service.runtime` |
| `restart_service` | Force-restart all tasks without rebuilding | `application.reload` | `service.runtime` |
| `set_env` | Merge variables into one scope; returns a key-level diff | `<scope>.saveEnvironment` | `secrets.write` (+ `settings.manage` for the org scope) |
| `add_domain` | Attach a domain and re-sync Traefik | `domain.create` | `domains.manage` |
| `remove_domain` | Delete a domain and re-sync Traefik | `domain.delete` | `domains.manage` |
| `run_backup` | Dump + upload + apply retention, now | `backup.runManually` | `backups.manage` + instance admin |
| `verify_backup` | Restore into a throwaway container and report whether the dump is usable | `backup.verify` | `backups.manage` + instance admin |
| `acknowledge_incident` | Mark an incident as being worked on (stops re-notifying) | `observability.acknowledgeIncident` | `project.write` |
| `resolve_incident` | Close an incident with an optional note | `observability.resolveIncident` | `project.write` |

### Notes on specific tools

- **`get_service_metrics` covers remote servers.** `monitoring.replicaStats`
  samples pinned services over SSH (the service row's own `serverId` decides,
  not the argument). When no replica is running — stopped service, crash loop,
  or an SSH sample that came back empty — the tool falls back to
  `monitoring.fleetOverview` and returns the newest 30-second sample from the
  metrics cron, with `source: "sampled"`. A remote service therefore never
  answers with a bare empty array.
- **`set_env` is read-merge-write.** Storage is one `.env` blob per scope, so a
  concurrent edit between the read and the write is lost. `replace: true` skips
  the read and overwrites everything. Values only take effect on the next
  deploy, redeploy or reload.
- **`get_env` / `get_resolved_env` respect redaction.** Without `secrets.read`
  the values are hidden; `get_env` then returns `redacted: true` and no keys.
- **`verify_backup` is slow.** It pulls an image and restores the full dump
  into a disposable container. It never touches the live database —
  `backup.restore` (deliberately *not* exposed over MCP) does.
- **Destructive tools are intentionally missing.** There is no MCP tool to
  delete a project, service, database or backup, and none to restore a backup
  over live data. Use the CLI or the panel for those.

## Implementation notes

- Tool definitions and the transport live in
  `packages/server/src/modules/mcp/` (unit-tested with vitest, no Next.js
  dependency); `apps/web/src/app/api/mcp/route.ts` is only the HTTP adapter.
- API-key verification, rate limiting, ban checks and org resolution are
  shared with the REST adapter via
  `packages/server/src/lib/api-key-context.ts`.
- Errors surface as MCP tool errors carrying the tRPC code and message
  (e.g. `FORBIDDEN: This action requires the "domains.manage" capability`).
