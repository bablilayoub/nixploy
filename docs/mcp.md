# MCP server (AI agents)

Nixploy exposes an [MCP](https://modelcontextprotocol.io) (Model Context
Protocol) server so AI agents — Claude Desktop, Cursor, and other MCP clients —
can inspect and operate your instance: list projects and services, read logs
and deployments, deploy / start / stop / restart services, and manage domains.

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

The key acts as the owning user: the agent sees the organizations that user
belongs to and can only do what that user's role allows (for example
`remove_domain` requires the `domains.manage` capability). For multi-org keys,
send `x-organization-id: <org-id>` to select a specific organization; otherwise
the first membership is used.

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
curl -X POST https://nixploy.example.com/api/mcp \
	-H "Authorization: Bearer <your-api-key>" \
	-H "Content-Type: application/json" \
	-H "Accept: application/json, text/event-stream" \
	-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

## 3. Tool reference

All inputs are validated with zod; outputs are compact JSON. Deploy/start/
stop/restart target **applications** (compose stacks and databases are
read-only through MCP today).

| Tool | What it does | tRPC procedure |
| --- | --- | --- |
| `list_projects` | Projects of the caller's org, with environments and service counts | `project.all` |
| `list_services` | Every service of a project (applications, compose, databases) with status and `appName` | `project.one` |
| `get_service_logs` | Build/deploy log of a service (latest deployment, or a given `deploymentId`), capped to the last 16k chars | `deployment.getLogs` |
| `list_deployments` | Recent deployments of one service with status and duration | `deployment.byApplication` / `deployment.byCompose` |
| `deploy_service` | Queue a fresh build + deploy (needs `service.deploy`) | `application.deploy` |
| `stop_service` | Scale the swarm service to 0 (needs `service.runtime`) | `application.stop` |
| `start_service` | Scale back to the configured replica count (needs `service.runtime`) | `application.start` |
| `restart_service` | Force-restart all tasks without rebuilding (needs `service.runtime`) | `application.reload` |
| `list_domains` | Domains of an application, compose service, or project | `domain.all` |
| `add_domain` | Attach a domain and re-sync Traefik (needs `domains.manage`) | `domain.create` |
| `remove_domain` | Delete a domain and re-sync Traefik (needs `domains.manage`) | `domain.delete` |
| `get_service_metrics` | Latest CPU/memory per replica, by `appName` (local-host services) | `monitoring.replicaStats` |
| `list_templates` | One-click template catalog (read-only) | `template.all` |

## Implementation notes

- Tool definitions and the transport live in
  `packages/server/src/modules/mcp/` (unit-tested with vitest, no Next.js
  dependency); `apps/web/src/app/api/mcp/route.ts` is only the HTTP adapter.
- API-key verification, rate limiting, ban checks and org resolution are
  shared with the REST adapter via
  `packages/server/src/lib/api-key-context.ts`.
- Errors surface as MCP tool errors carrying the tRPC code and message
  (e.g. `FORBIDDEN: This action requires the "domains.manage" capability`).
