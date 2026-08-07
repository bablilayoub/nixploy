# REST API

Every tRPC procedure in Nixploy is also exposed as a REST endpoint. The same surface powers the dashboard, Swagger UI, and `@nixploy/cli`.

Live OpenAPI docs live on **your panel** at `/swagger` (and the raw schema at `/api/openapi.json`). They are not hosted on [nixploy.com](https://nixploy.com) — the marketing site only documents conventions.

## Auth

Create an API key under **Settings → Profile** in the panel. Send it on every request:

```http
x-api-key: nxlp_...
```

Session cookies are for the browser UI; scripts and CI should use API keys.

## URL shape

The catch-all handler maps procedures to:

| Kind | Method | Path | Input |
| --- | --- | --- | --- |
| Query | `GET` | `/api/<router>.<procedure>` | Query params, or a URL-encoded JSON `input` param for nested objects |
| Mutation | `POST` | `/api/<router>.<procedure>` | JSON body |

Examples:

```text
GET  /api/project.all
GET  /api/project.one?input=%7B%22projectId%22%3A%22...%22%7D
POST /api/project.create
```

There is no `/api/v1` prefix — paths are `/api/<router>.<procedure>`.

## curl examples

List projects:

```bash
curl -sS -H "x-api-key: $NIXPLOY_API_KEY" \
  "https://panel.example.com/api/project.all"
```

Create a project (shape depends on the procedure input schema — check `/swagger`):

```bash
curl -sS -X POST \
  -H "x-api-key: $NIXPLOY_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"my-app"}' \
  "https://panel.example.com/api/project.create"
```

## CLI

Prefer the CLI when you want typed commands instead of raw HTTP:

```bash
npm i -g @nixploy/cli
nixploy auth login --url https://panel.example.com --api-key nxlp_...
nixploy doctor
nixploy app list --project-id <id>
```

The CLI talks to the same REST endpoints.

## Swagger

On a running panel:

- UI: `https://<your-panel>/swagger`
- Spec: `https://<your-panel>/api/openapi.json`

Authenticate in Swagger with the `x-api-key` header (Authorize button).

## Related

- [auth.md](./auth.md) — better-auth, orgs, roles, API keys
- [architecture.md](./architecture.md) — request surfaces
- [getting-started.md](./getting-started.md) — first deploy + CLI
- Marketing overview: [nixploy.com/api](https://nixploy.com/api)
