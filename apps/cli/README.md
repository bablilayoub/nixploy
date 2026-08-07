# @nixploy/cli

Command-line interface for [Nixploy](https://nixploy.com) — a self-hosted PaaS. Manage projects, applications, databases and environment variables against any Nixploy server over its REST API.

## Install

```bash
npm install -g @nixploy/cli
# or run from the monorepo
pnpm --filter @nixploy/cli build && pnpm --filter @nixploy/cli exec nixploy --help
```

Requires Node.js >= 22.

## Authentication

Generate an API key in the Nixploy dashboard (**Settings → Profile → API Keys**), then:

```bash
nixploy auth login --url https://panel.nixploy.com --api-key nxlp_...
nixploy auth status
```

Credentials are stored in `~/.nixploy/config.json` (mode `0600`). Precedence for every request:

1. Global flags `--url` / `--api-key`
2. Environment variables `NIXPLOY_API_URL` / `NIXPLOY_API_KEY`
3. `~/.nixploy/config.json`

All requests send the key as the `x-api-key` header.

## Commands

```bash
# Projects
nixploy project list [--json]
nixploy project create --name my-project [--description "..."] [--json]

# Applications
nixploy app list --project-id <id> [--env <name>] [--json]
nixploy app create --project-id <id> --name my-app [--env <name>] [--json]
nixploy app deploy <applicationId>
nixploy app redeploy <applicationId>
nixploy app logs <applicationId>

# Compose stacks
nixploy compose list --project-id <id> [--env <name>] [--json]
nixploy compose create --project-id <id> --name my-stack [--env <name>] [--type docker-compose|stack]
nixploy compose one <composeId>
nixploy compose deploy <composeId>
nixploy compose redeploy <composeId>
nixploy compose logs <composeId> [-f]
nixploy compose env <composeId> [--set "..."]
nixploy compose pull <composeId>
nixploy compose save <composeId> --file ./docker-compose.yml

# Templates
nixploy template list [--json]
nixploy template one <templateId>
nixploy template deploy <templateId> --project-id <id> --env <name> \
  [--var KEY=VALUE ...] [--domain host:service:port ...]

# Tags
nixploy tag list [--json]
nixploy tag create --name production [--color "#22c55e"] [--json]
nixploy tag set --service-type application --service-id <id> --tag-id <id> [<id>...]

# Databases (postgres, mysql, mariadb, mongo, redis)
nixploy db list --project-id <id> [--env <name>] [--json]

# Environment variables (KEY=VALUE, dotenv format)
nixploy env list <serviceId> [--type app|compose|postgres|mysql|mariadb|mongo|redis]
nixploy env set <serviceId> KEY=VALUE [KEY2=VALUE2 ...] [--replace] [--type ...]
```

`env set` merges with existing variables by default; pass `--replace` to overwrite the whole set. Values are transmitted to the server, which stores them encrypted at rest.

## REST API convention

The CLI targets the REST/OpenAPI surface generated from the tRPC routers:

- Queries: `GET /api/<router>.<procedure>?<input as search params>`
- Mutations: `POST /api/<router>.<procedure>` with a JSON body
- Auth: `x-api-key: <key>` header
- tRPC-style envelopes (`{ "result": { "data": ... } }`) are unwrapped automatically.

Endpoints used: `project.all`, `project.create`, `application.all`, `application.create`, `application.deploy`, `application.redeploy`, `application.logs`, `<type>.all` / `<type>.one` / `<type>.saveEnvironment` for each service type.

## Development

```bash
pnpm install
pnpm --filter @nixploy/cli typecheck
pnpm --filter @nixploy/cli build
```
