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

32 tools (13 before this pass). All inputs are validated with zod; outputs are compact JSON. Every
call goes through `appRouter.createCaller`, so the capability listed below is
enforced by the router, not by the tool.

### Read-only

| Tool | What it does | tRPC procedure |
| --- | --- | --- |
| `list_projects` | Projects of the caller's org, with environments and service counts | `project.all` |
| `list_services` | Every service of a project (applications, compose, databases) with status and `appName` | `project.one` |
| `list_databases` | Database services of a project across all five engines | `<engine>.all` |
| `get_database` | One database's configuration plus its live container status | `<engine>.one` + `getStatus` |
| `get_service_logs` | Build/deploy log of a service (latest deployment, or a given `deploymentId`), capped to the last 16k chars | `deployment.getLogs` |
| `list_deployments` | Recent deployments of one service with status and duration | `deployment.byApplication` / `byCompose` |
| `get_deployment_provenance` | Commit SHA, message, author, trigger and who triggered each recent deployment | `deployment.byApplication` / `byCompose` |
| `list_rollback_points` | Image pins kept per application (5 most recent) | `rollback.all` |
| `list_domains` | Domains of an application, compose service, or project | `domain.all` |
| `list_previews` | Pull-request previews of an application with PR metadata and expiry | `previewDeployment.byApplication` |
| `get_env` | Variables at one scope (organization / project / environment / service) | `organization.environment`, `project.one`, `environment.byProject`, `<router>.one` |
| `get_resolved_env` | The merged org → project → environment → service view with each key's origin | `project.getResolvedEnvironment` |
| `list_incidents` | Alert firings, deploy-failure streaks, watchdog events, uptime flips | `observability.incidents` |
| `list_backups` | Backup schedules of a database (or of the instance) with their last run | `backup.all` |
| `list_backup_runs` | Run history: status, trigger, size, object key, error | `backup.runs` |
| `get_service_metrics` | CPU/memory per replica, by `appName` — local **and** remote nodes | `monitoring.replicaStats` (+ `fleetOverview` fallback) |
| `get_platform_health` | Database, Docker, migrations, queue depth, Traefik, version | `/api/ready` internals |
| `list_templates` | One-click template catalog | `template.all` |

### Guarded writes

Each needs the capability in the last column; without it the tool answers
`FORBIDDEN` and nothing changes.

| Tool | What it does | tRPC procedure | Capability |
| --- | --- | --- | --- |
| `deploy_service` | Queue a fresh build + rollout of an application | `application.deploy` | `service.deploy` |
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
