# REST API

Every tRPC procedure in Nixploy is also exposed as a REST endpoint. The same surface powers the dashboard, Swagger UI, `@nixploy/cli`, and the MCP server.

**Marketing reference (endpoint catalog):** [nixploy.com/api](https://nixploy.com/api)  
**Live OpenAPI:** on **your panel** at `/swagger` and `/api/openapi.json` (not hosted on nixploy.com).

## Auth

Create an API key under **Settings → Profile**. Send it on every request:

```http
x-api-key: nxlp_...
```

Session cookies are for the browser UI; scripts and CI should use API keys.

## URL shape

| Kind | Method | Path | Input |
| --- | --- | --- | --- |
| Query | `GET` | `/api/<router>.<procedure>` | Query params, or URL-encoded JSON `input` for nested objects |
| Mutation | `POST` | `/api/<router>.<procedure>` | JSON body |

Examples:

```text
GET  /api/project.all
GET  /api/project.one?input=%7B%22projectId%22%3A%22...%22%7D
POST /api/project.create
```

There is no `/api/v1` prefix.

Flattened GET params are strings; the adapter converts a value to a number or
boolean **only** when the procedure's Zod schema declares that field as such
(`packages/server/src/trpc/query-input.ts`), so `?search=2024` stays a string.
Nested objects go through `?input=<URL-encoded JSON>`.

`/api/openapi.json` and `/swagger` are served to browser sessions only (the
spec enumerates every procedure); API keys use the endpoints directly.

## curl examples

```bash
curl -sS -H "x-api-key: $NIXPLOY_API_KEY" \
  "https://panel.example.com/api/project.all"

curl -sS -X POST \
  -H "x-api-key: $NIXPLOY_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"my-app"}' \
  "https://panel.example.com/api/project.create"
```

## CLI

```bash
npm i -g @nixploy/cli
nixploy auth login --url https://panel.example.com --api-key nxlp_...
nixploy doctor
nixploy app list --project-id <id>
```

## MCP

AI agents can call the same org-scoped surface via JSON-RPC:

```text
POST /api/mcp
Header: x-api-key: nxlp_...
```

See [mcp.md](./mcp.md).

## Router catalog

High-level map of the OpenAPI surface (42 routers). Full input/output schemas live on panel Swagger.

| Router | Purpose |
| --- | --- |
| `project` | Projects, overview, search, project env |
| `environment` | Environments — create, duplicate, clone, env vars |
| `application` | Apps — CRUD, deploy, source, env, Swarm options, rollback |
| `compose` | Compose/stack services — deploy, file, env, containers |
| `template` | Catalog list + one-click deploy |
| `domain` | Domains, TLS, traefik.me generator |
| `deployment` | History, logs, stats |
| `previewDeployment` | PR previews — approve/deny fork gate |
| `postgres` / `mysql` / `mariadb` / `mongo` / `redis` | Database services |
| `backup` | DB backup schedules, run, restore |
| `volumeBackup` | Named-volume backup schedules |
| `destination` | S3-compatible backup storage |
| `gitops` | Export / plan / apply / sync `nixploy.yaml` |
| `github` / `gitlab` / `gitea` / `bitbucket` | Git providers |
| `server` | Remote servers, Swarm setup, stats |
| `docker` | Control center — containers, images, nodes, prune |
| `monitoring` | Live + historical metrics, fleet |
| `observability` | Incidents, alert rules, uptime, log search |
| `schedule` | Cron jobs for apps/compose/servers |
| `notification` | Multi-channel notification configs |
| `organization` | Settings, invites, capabilities, shared (org-level) env vars |
| `ai` | Deploy Copilot — explain, chat, generate compose |
| `certificate` / `registry` / `sshKey` / `tag` | Certs, registries, SSH keys, tags |
| `mount` / `port` / `redirect` / `security` | App advanced config |
| `rollback` | Rollback targets |
| `audit` | Audit log |
| `updates` | In-app GHCR updates |
| `webServer` | Panel access domain, Traefik, host health |
| `setup` | First-boot / invitation preview (public) |

## Swagger

On a running panel:

- UI: `https://<your-panel>/swagger`
- Spec: `https://<your-panel>/api/openapi.json`

Authenticate with the `x-api-key` header (Authorize button).

## Related

- [auth.md](./auth.md) — better-auth, orgs, roles, capabilities, API keys
- [mcp.md](./mcp.md) — MCP tools
- [architecture.md](./architecture.md) — request surfaces
- [getting-started.md](./getting-started.md) — first deploy + CLI
- Website: [nixploy.com/api](https://nixploy.com/api) · [nixploy.com/docs](https://nixploy.com/docs)
