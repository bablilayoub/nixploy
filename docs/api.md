# REST API

Every tRPC procedure in Nixploy is also exposed as a REST endpoint. The same surface powers the dashboard, Swagger UI, `@nixploy/cli`, and the MCP server.

**Marketing reference (endpoint catalog):** [nixploy.com/api](https://nixploy.com/api)  
**Live OpenAPI:** on **your panel** at `/swagger` and `/api/openapi.json` (not hosted on nixploy.com).

## Auth

Create an API key under **Settings → Profile**. Send it on every request:

```http
x-api-key: nxp_...
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

## Responses

Success is always the tRPC envelope:

```json
{ "result": { "data": { "projectId": "proj_123", "name": "shop" } } }
```

Errors carry a top-level `message` plus a tRPC-ish `error` object, and the HTTP
status maps from the tRPC code:

```json
{
  "message": "This action requires the \"domains.manage\" capability",
  "error": { "message": "…", "code": -32003, "data": { "code": "FORBIDDEN", "httpStatus": 403 } }
}
```

| Status | When |
| --- | --- |
| `400` | Zod validation failed on the input |
| `401` | Missing, expired or revoked API key |
| `403` | The key's user lacks a required capability |
| `404` | Unknown procedure, or the resource is not in the caller's organization |
| `429` | Per-key rate limit exceeded |

Cross-tenant reads answer `404`, not `403` — the API never confirms that an id
exists in another organization.

Secret-bearing fields (`env`, `buildArgs`, `previewEnv`, hook commands, an
inline `composeFile`, database passwords, file-mount `content`, schedule
commands) come back as `null` when the key's user lacks `secrets.read`, and
the row then carries `secretsRedacted: true`. Without the flag a `null` means
the value is genuinely unset; a client that wants to edit env should check
the flag before it treats an empty value as empty.

## Capabilities per endpoint

Every operation in the spec carries `x-nixploy-capability`: the organization
capabilities the key's user must hold for that call
(`packages/server/src/trpc/procedure-docs.ts` is the source; see
[auth.md](./auth.md) for the catalog and the role ladder). Operations that
additionally require the platform owner carry `x-nixploy-instance-admin`.

```bash
# Which endpoints need domains.manage?
curl -s https://panel.example.com/api/openapi.json \
  | jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[]
           | select(.value["x-nixploy-capability"] // [] | index("domains.manage"))
           | "\(.key|ascii_upcase) \($p)"'
```

## Scopes

A key carries a **scope**: a ceiling on the capabilities it may use, applied on
top of (never instead of) its owner's own capabilities. Pick the narrowest one
the client needs in **Settings → Profile → API keys**.

| Scope | Capability ceiling | Typical use |
| --- | --- | --- |
| `read` | `audit.read`, `secrets.read` — plus every list/read procedure, which needs no capability | Dashboards, status checks, `nixploy ... list` |
| `deploy` | read + `service.deploy`, `service.runtime` | CI redeploys, the deploy webhook, start/stop |
| `write` | deploy + `service.write`, `domains.manage`, `secrets.write` | GitOps-style config pushes |
| `admin` | the owner's full capability set | Automation that manages servers, members, registries |

The effective set is **scope ∩ owner's capabilities**, so a `write` key held by
a `viewer` still cannot write. Out-of-scope calls fail with `403 FORBIDDEN` and
name the scope:

```json
{ "message": "This action requires the \"project.write\" capability, outside this API key scope (read)" }
```

Scope and organization binding live on the key row (`apikey.permissions` /
`apikey.metadata`) and are enforced in
`packages/server/src/lib/api-key-context.ts` for every transport — REST, MCP,
and `/api/webhooks/deploy/<appName>`.

Keys created before scopes existed carry neither column. They keep the old
behaviour (owner's full set, organization from the header or the first
membership) and are shown as **Legacy — full access** in the panel. Replace
them with a scoped key when convenient.

### Expiry and prefix

- New keys default to **90 days**; the panel offers 7/30/90 days and 1 year,
  and the plugin caps a custom `expiresIn` at 1 year.
- **Never** is available to the instance admin only.
- Every key is prefixed `nxp_` so secret scanners (GitHub, gitleaks) recognise
  one that leaks into a repository or build log.
- The panel shows **Last used** per key (`apikey.lastRequest`).

## Multi-organization keys

A key resolves to one organization per request: the organization it is **bound**
to (`apikey.metadata.organizationId`, set when the key is created), otherwise
the `x-organization-id` header, otherwise the user's first membership.

A bound key refuses every other organization — a contradicting
`x-organization-id` is rejected outright, and ids from another tenant resolve to
the usual `404`/`403`:

```bash
# unbound (legacy) key: pick the organization per request
curl -sS -H "x-api-key: $NIXPLOY_API_KEY" -H "x-organization-id: org_abc" \
  "https://panel.example.com/api/project.all"

# bound key: the header is redundant, and any other value is refused
# {"message":"This API key is bound to a different organization"}
```

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
echo "$NIXPLOY_API_KEY" | nixploy auth login --url https://panel.example.com
nixploy doctor
nixploy app list --project-id <id> --json
```

Full command reference, profiles, exit codes and scripting recipes:
[cli.md](./cli.md).

## Typed client (`openapi-typescript`)

There is no published SDK; generate one from your own panel's spec instead —
it always matches the version you are running.

```bash
npm i -D openapi-typescript openapi-fetch
npx openapi-typescript https://panel.example.com/api/openapi.json -o src/nixploy-api.d.ts
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./nixploy-api";

const client = createClient<paths>({
	baseUrl: "https://panel.example.com",
	headers: { "x-api-key": process.env.NIXPLOY_API_KEY! },
});

const { data } = await client.GET("/api/project.all");
//    ^ typed from the spec; payloads live under data.result.data
```

The spec is browser-session gated, so fetch it while signed in (or export it
from a machine with a session) rather than from CI. Input schemas are emitted
from the routers' Zod schemas and are exact. Response bodies are typed only for
procedures that declare `.output(schema)` — most do not yet, so `result.data`
comes through loosely typed; adopting `.output()` in a router immediately
sharpens both Swagger and the generated client.

## MCP

AI agents can call the same org-scoped surface via JSON-RPC:

```text
POST /api/mcp
Header: x-api-key: nxp_...
```

See [mcp.md](./mcp.md).

## Router catalog

High-level map of the OpenAPI surface (44 routers). Full input/output schemas live on panel Swagger.

| Router | Purpose |
| --- | --- |
| `project` | Projects, overview, search, project env |
| `environment` | Environments — create, duplicate, clone, env vars |
| `application` | Apps — CRUD, deploy, source, env, Swarm options, rollback |
| `compose` | Compose/stack services — deploy, file, env, containers |
| `template` | Catalog list + one-click deploy |
| `domain` | Domains, TLS, traefik.me generator |
| `upstream` | External upstreams — origins outside the Swarm fronted by Traefik |
| `deployment` | History, logs, stats |
| `previewDeployment` | PR previews — approve/deny fork gate |
| `postgres` / `mysql` / `mariadb` / `mongo` / `redis` | Database services |
| `backup` | DB backup schedules, run, restore |
| `volumeBackup` | Named-volume backup schedules |
| `destination` | S3-compatible backup storage |
| `gitops` | Export / plan / apply / sync `nixploy.yaml`, seal and apply the secrets bundle |
| `import` | Inspect, plan and import one environment from another panel — over its API, or from an uploaded database dump (`POST /api/import/dump`) |
| `github` / `gitlab` / `gitea` / `bitbucket` | Git providers |
| `server` | Remote servers, Swarm setup, stats |
| `docker` | Control center — containers, images, nodes, prune |
| `monitoring` | Live + historical metrics, fleet |
| `observability` | Incidents (acknowledge / resolve), alert rules, uptime probes, the public status page, log search |
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

Authenticate with the `x-api-key` header (Authorize button). Endpoints are
grouped by router tag, each operation carries a summary, a description of its
side effects and its `x-nixploy-capability` requirement.

The spec is generated at request time from the live router
(`packages/server/src/trpc/openapi.ts`); the prose lives in
`packages/server/src/trpc/procedure-docs.ts`, and a vitest suite fails the
build when a registered procedure has no entry there.

## Related

- [cli.md](./cli.md) — `@nixploy/cli` command reference and scripting
- [auth.md](./auth.md) — better-auth, orgs, roles, capabilities, API keys
- [mcp.md](./mcp.md) — MCP tools
- [architecture.md](./architecture.md) — request surfaces
- [getting-started.md](./getting-started.md) — first deploy + CLI
- Website: [nixploy.com/api](https://nixploy.com/api) · [nixploy.com/docs](https://nixploy.com/docs)
