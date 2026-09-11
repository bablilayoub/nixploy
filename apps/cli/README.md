# @nixploy/cli

Command-line interface for [Nixploy](https://nixploy.com), the self-hosted PaaS.
Drives the same REST API as the dashboard: projects, applications, compose
stacks, databases, domains, environment variables, deployments, backups,
schedules, servers and previews.

Full reference — every command group with examples, exit codes and scripting
recipes: **[docs/cli.md](https://github.com/bablilayoub/nixploy/blob/main/docs/cli.md)**.

## Install

```bash
npm i -g @nixploy/cli
```

Node 22+. One runtime dependency (commander).

## Authenticate

Create an API key in the panel under **Settings → Profile → API keys**, then:

```bash
# prompts for the key with echo off
nixploy auth login --url https://panel.example.com

# CI: pipe it in — never pass a key as an argument, `ps` shows it
echo "$NIXPLOY_API_KEY" | nixploy auth login --url https://panel.example.com
```

Credentials live in `~/.nixploy/config.json` (mode `0600`). Override per
invocation with `--url` / `--api-key`, or with `NIXPLOY_API_URL` /
`NIXPLOY_API_KEY`. Several panels or organizations at once:

```bash
echo "$KEY" | nixploy auth login --url https://staging.example.com --profile staging
nixploy --profile staging app list --project-id proj_123
```

## Quick tour

```bash
nixploy doctor                                   # panel readiness, versions, Swarm, disk
nixploy org current                              # which organization this key acts in
nixploy project list
nixploy project create --name shop

nixploy app create --project-id proj_123 --name api
nixploy app update-source app_abc --docker-image traefik/whoami:v1.10.1
nixploy app deploy app_abc
nixploy app logs app_abc -f
nixploy domain add api.example.com --application-id app_abc --port 80 --https
nixploy app stop app_abc

nixploy db create postgres --project-id proj_123 --name main \
  --database app --user app --password "$PG_PASSWORD"
nixploy db connection-url postgres pg_abc

nixploy env set LOG_LEVEL=debug --scope project --project-id proj_123
nixploy env resolved --project-id proj_123 --env production

nixploy backup run bkp_abc
nixploy backup verify bkp_abc
nixploy deployment rollback app_abc --rollback-id rb_abc
```

Command groups: `app`, `audit`, `auth`, `backup`, `compose`, `db`,
`deployment`, `doctor`, `domain`, `env`, `environment`, `gitops`, `incident`,
`monitoring`, `notification`, `org`, `preview`, `project`, `registry`,
`schedule`, `server`, `ssh-key`, `tag`, `template`, `updates`, plus the
top-level `plan` / `apply` / `sync` GitOps verbs. `nixploy <group> --help`
lists the verbs of any group.

## Scripting

Every command accepts `--json` (raw API payload) and `--quiet` (identifiers
only, one per line):

```bash
nixploy app list --project-id proj_123 --json | jq -r '.[].appName'
nixploy app list --project-id proj_123 --quiet | xargs -n1 nixploy app redeploy
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Runtime error (API rejected the call, network failure) |
| `2` | Usage error (unknown flag, missing option, bad value) |
| `3` | Not found or forbidden (HTTP 401 / 403 / 404) |

Destructive verbs (`delete`, `remove`, `backup restore`, `updates apply`)
require `--yes`.

## GitOps

```bash
nixploy gitops export --project-id proj_123 --env production -o nixploy.yaml
nixploy plan  -f nixploy.yaml
nixploy apply -f nixploy.yaml
```

## Links

- CLI reference: [docs/cli.md](https://github.com/bablilayoub/nixploy/blob/main/docs/cli.md)
- REST API: [docs/api.md](https://github.com/bablilayoub/nixploy/blob/main/docs/api.md)
- MCP (AI agents): [docs/mcp.md](https://github.com/bablilayoub/nixploy/blob/main/docs/mcp.md)
- Project: [nixploy.com](https://nixploy.com) · [GitHub](https://github.com/bablilayoub/nixploy)

## License

Apache-2.0
