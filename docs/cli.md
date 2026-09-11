# CLI (`@nixploy/cli`)

`nixploy` drives the same REST surface as the dashboard — every command is one
`/api/<router>.<procedure>` call authenticated with an API key. Anything you can
do in the panel that matters for automation (deploy, stop, roll back, edit env,
attach a domain, run a backup) is scriptable.

**Related:** [api.md](./api.md) (REST conventions) · [auth.md](./auth.md) (API keys,
capabilities) · [mcp.md](./mcp.md) (the same surface for AI agents)

## Install

```bash
npm i -g @nixploy/cli     # or: pnpm add -g @nixploy/cli
nixploy --version
```

Requires Node 22+. The CLI ships one runtime dependency (commander) and never
touches Docker or the filesystem of the panel host — it only speaks HTTP.

## Authenticate

Create an API key in the panel under **Settings → Profile → API keys**. The key
is shown once.

```bash
# Interactive: prompts for the key with echo off
nixploy auth login --url https://panel.example.com

# CI: pipe it on stdin, never on the command line
echo "$NIXPLOY_API_KEY" | nixploy auth login --url https://panel.example.com
```

The key is stored in `~/.nixploy/config.json` (mode `0600`). Passing
`--api-key` still works but warns: process arguments are visible in `ps` and
land in shell history.

Check what the key can do:

```bash
nixploy auth status      # is the key still valid?
nixploy auth whoami      # organization + capability list
nixploy doctor           # panel readiness, versions, Swarm, Docker, disk
```

### Profiles

One machine, several panels (or several organizations):

```bash
echo "$STAGING_KEY" | nixploy auth login --url https://staging.example.com --profile staging
nixploy auth profiles                       # list, marking the active one
nixploy --profile staging app list --project-id proj_123
nixploy auth logout --profile staging
```

Resolution order for every setting:

| Setting | Order |
| --- | --- |
| Panel URL | `--url` → `NIXPLOY_API_URL` / `NIXPLOY_URL` → profile → `http://localhost:3000` |
| API key | `--api-key` → `NIXPLOY_API_KEY` → profile |
| Profile | `--profile` → `NIXPLOY_PROFILE` → `current` in the config file → `default` |
| Organization | `--organization-id` → `NIXPLOY_ORG_ID` → profile pin → the key's default |

### Organizations

An API key resolves to exactly one organization per request: the one stored in
the key's metadata when the key is bound to an org, otherwise the
`x-organization-id` header, otherwise the user's first membership.

```bash
nixploy org current            # which org am I acting in?
nixploy org use org_abc123     # pin the active profile to another org
nixploy org use --clear        # back to the key's default
```

## Output and exit codes

Every command takes `--json` and `--quiet`:

```bash
nixploy app list --project-id proj_123                 # table
nixploy app list --project-id proj_123 --json          # raw API payload
nixploy app list --project-id proj_123 --quiet         # one id per line
```

`--json` prints exactly what the API returned, so `jq` works on the real shape.
`--quiet` prints only the identifying column — made for `xargs`:

```bash
nixploy app list --project-id proj_123 --quiet | xargs -n1 nixploy app redeploy
```

Exit codes (stable; scripts may branch on them):

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Runtime error — the API rejected the call, or the network failed |
| `2` | Usage error — unknown command or flag, missing required option, bad value |
| `3` | Not found or forbidden — HTTP 401, 403 or 404 |

Destructive verbs (`delete`, `remove`, `backup restore`, `updates apply`)
require `-y, --yes`; without it they exit `2` and change nothing.

Every request has a 30 s timeout. `nixploy app logs -f` polls, so following a
long build is a sequence of short requests, not one hanging connection.

## Command groups

### `app` — applications

```bash
nixploy app list --project-id proj_123 [--env production]
nixploy app get app_abc
nixploy app create --project-id proj_123 --name api [--env production] [--server-id srv_1]
nixploy app update-source app_abc --docker-image traefik/whoami:v1.10.1
nixploy app update-source app_abc --git-url git@github.com:acme/api.git --branch main --ssh-key-id key_1
nixploy app update-source app_abc --github-id gh_1 --owner acme --repository api --branch main --auto-deploy
nixploy app build-type app_abc --type dockerfile --dockerfile ./Dockerfile --target runtime
nixploy app deploy app_abc [--title "release 1.4.0"]
nixploy app redeploy app_abc            # re-roll the current image, no rebuild
nixploy app logs app_abc -f             # follow the build log to completion
nixploy app status app_abc              # state, replicas, source, domains
nixploy app stop app_abc  /  start  /  restart
nixploy app move app_abc --environment-id env_2
nixploy app duplicate app_abc [--environment-id env_2]
nixploy app kill-build app_abc
nixploy app delete app_abc --yes
nixploy app env get|set|import|export app_abc
```

### `compose` — compose and Swarm stacks

```bash
nixploy compose list --project-id proj_123
nixploy compose create --project-id proj_123 --name stack [--type stack] [--source git]
nixploy compose file get cmp_abc -o docker-compose.yml
nixploy compose file set cmp_abc -f docker-compose.yml     # '-' reads stdin
nixploy compose deploy cmp_abc
nixploy compose logs cmp_abc -f
nixploy compose services cmp_abc          # service keys in the file
nixploy compose containers cmp_abc        # running containers
nixploy compose start|stop cmp_abc
nixploy compose delete cmp_abc --yes
nixploy compose env get|set|import|export cmp_abc
```

### `db` — databases

The engine is the first positional, so one group covers all five routers.

```bash
nixploy db list --project-id proj_123 [--type postgres]
nixploy db create postgres --project-id proj_123 --name main \
  --database app --user app --password "$PG_PASSWORD" [--image postgres:17]
nixploy db get postgres pg_abc
nixploy db start|stop|restart postgres pg_abc
nixploy db connection-url postgres pg_abc     # needs the secrets.read capability
nixploy db status postgres pg_abc
nixploy db external-port postgres pg_abc --port 5433   # 0 unpublishes
nixploy db backups postgres pg_abc
nixploy db env get|set postgres pg_abc
nixploy db delete postgres pg_abc --yes       # removes the data volume too
```

`--password` is visible in `ps` while the command runs. For anything but a
throwaway database, create it in the panel or feed the value from a secret
store on the same line (`--password "$(vault kv get -field=pw …)"`).

### `domain` — Traefik routing

```bash
nixploy domain list --application-id app_abc
nixploy domain add app.example.com --application-id app_abc --port 80 --https
nixploy domain add demo.traefik.me --application-id app_abc --port 80   # plain HTTP
nixploy domain generate --app-name api          # free *.traefik.me host
nixploy domain validate app.example.com         # is the host free instance-wide?
nixploy domain set-https dom_abc --enabled true
nixploy domain remove dom_abc --yes
```

Middleware chains are replace-all on the server (one atomic Traefik rewrite),
so `add` and `remove` read the current chain first:

```bash
nixploy domain middleware list dom_abc
nixploy domain middleware add dom_abc rateLimit --config '{"average":100,"burst":50}'
nixploy domain middleware add dom_abc ipAllowList --config '{"sourceRange":["10.0.0.0/8"]}'
nixploy domain middleware remove dom_abc rateLimit
```

Kinds: `rateLimit`, `ipAllowList`, `headers`, `compress`, `forwardAuth`,
`stickyCookie`, `maintenance`.

### `env` — variables at every scope

Variables inherit organization → project → environment → service; the deeper
level wins on a key clash.

```bash
nixploy env get --scope organization
nixploy env get --scope project --project-id proj_123
nixploy env get --scope environment --project-id proj_123 --env production
nixploy env get --scope service --type app --service-id app_abc

nixploy env set LOG_LEVEL=debug --scope project --project-id proj_123
nixploy env set API_URL=https://api.example.com --scope service --type app --service-id app_abc
nixploy env import -f .env --scope service --type app --service-id app_abc
nixploy env export --scope project --project-id proj_123 -o project.env

nixploy env resolved --project-id proj_123 --env production   # the merged view
```

`set` and `import` merge by default and print a key-level diff; `--replace`
drops everything not listed. Values never appear in the diff. Writes take
effect on the next deploy, redeploy or reload.

`--type` accepts `app`, `compose`, `postgres`, `mysql`, `mariadb`, `mongo`,
`redis`. The pre-0.2 spellings (`nixploy env list <id>`, `nixploy env set <id>
KEY=V`) still work.

### `deployment` — history, logs, rollback

```bash
nixploy deployment list --application-id app_abc [--limit 20]
nixploy deployment list --project-id proj_123
nixploy deployment recent
nixploy deployment get dep_abc
nixploy deployment logs dep_abc -f
nixploy deployment cancel dep_abc
nixploy deployment rollbacks app_abc                      # stored image pins
nixploy deployment rollback app_abc --rollback-id rb_abc
```

### `backup` — schedules, runs, restore

```bash
nixploy backup destination list
nixploy backup destination add --name s3 --bucket nixploy --region eu-west-1 \
  --endpoint https://s3.eu-west-1.amazonaws.com --access-key … --secret-key …
nixploy backup destination add --name disk --provider local
nixploy backup destination test dst_abc

nixploy backup create --destination-id dst_abc --schedule '0 3 * * *' \
  --database app --type postgres --service-id pg_abc --keep 7
nixploy backup list --type postgres --service-id pg_abc
nixploy backup runs bkp_abc            # status, size, error per run
nixploy backup keys bkp_abc            # stored object keys
nixploy backup run bkp_abc             # dump + upload + retention, now
nixploy backup verify bkp_abc          # restore into a throwaway container
nixploy backup restore bkp_abc --key dumps/2026-09-11.sql.gz --yes
```

`backup restore` overwrites the live database. `backup verify` never touches
it — it restores into a disposable container and reports whether the dump is
usable.

### `preview` — pull-request previews

```bash
nixploy preview list app_abc
nixploy preview approve pd_abc     # releases a fork PR held by the approval gate
nixploy preview deny pd_abc
nixploy preview delete pd_abc --yes
```

Approving a fork preview builds code from someone else's branch. Review the
diff first.

### `schedule` — cron jobs

```bash
nixploy schedule list
nixploy schedule create --name nightly --cron '0 2 * * *' --type application \
  --application-id app_abc --app-name api-abc123 --command 'php artisan queue:prune'
nixploy schedule run sch_abc
nixploy schedule enable|disable sch_abc
nixploy schedule delete sch_abc --yes
```

### `server` — remote Swarm nodes

```bash
nixploy server list
nixploy server add --name worker-1 --ip 10.0.0.5 --ssh-key-id key_1 [--role worker]
nixploy server test srv_abc        # SSH reachability
nixploy server setup srv_abc       # install Docker, join the Swarm
nixploy server stats srv_abc
nixploy server remove srv_abc --yes
```

### `monitoring` and `incident`

```bash
nixploy monitoring fleet                          # every service + latest sample
nixploy monitoring service api-abc123             # live per-replica CPU/memory
nixploy monitoring history api-abc123 --hours 6
nixploy monitoring server-history srv_abc --hours 24

nixploy incident list [--project-id proj_123]
nixploy incident alerts --application-id app_abc
nixploy incident probes
nixploy incident logs "connection refused" --limit 50
```

### `project`, `environment`, `template`, `tag`

```bash
nixploy project list
nixploy project create --name shop
nixploy project get proj_123
nixploy project overview                      # org-wide counters
nixploy project search api
nixploy project delete proj_123 --yes         # cascades to every service

nixploy environment list --project-id proj_123
nixploy environment create --project-id proj_123 --name staging
nixploy environment clone env_1 --name staging-copy
nixploy environment delete env_2 --yes

nixploy template list
nixploy template get plausible
nixploy template deploy plausible --project-id proj_123 --env production \
  --var BASE_URL=https://stats.example.com --domain stats.example.com:plausible:8000

nixploy tag list
nixploy tag create --name critical --color '#ef4444'
nixploy tag set --service-type application --service-id app_abc --tag-id tag_1 tag_2
```

### `registry`, `ssh-key`, `notification`, `updates`, `audit`

```bash
nixploy registry list
nixploy registry add --name ghcr --username acme --password "$GHCR_TOKEN" --url ghcr.io
nixploy registry test reg_abc

nixploy ssh-key list
nixploy ssh-key generate --name deploy-key      # returns the public half

nixploy notification list
nixploy notification test ntf_abc

nixploy updates status
nixploy updates check
nixploy updates apply --yes                     # the panel restarts itself

nixploy audit list --since 24h
nixploy audit list --action application.deploy --limit 100
nixploy audit facets
```

`--since` accepts an ISO timestamp or a relative window (`30m`, `24h`, `7d`)
and filters the fetched page client-side — raise `--limit` when widening it.

### `gitops` — desired state

```bash
nixploy gitops export --project-id proj_123 --env production -o nixploy.yaml
nixploy plan -f nixploy.yaml
nixploy apply -f nixploy.yaml
nixploy gitops sync-url --project-id proj_123
nixploy gitops sync-git --project-id proj_123
```

## Scripting with `--json`

Deploy and wait for the result:

```bash
set -euo pipefail
APP=$(nixploy app list --project-id "$PROJECT" --json | jq -r '.[] | select(.name=="api") | .applicationId')
DEP=$(nixploy app deploy "$APP" --json | jq -r '.deploymentId')
nixploy deployment logs "$DEP" -f
STATUS=$(nixploy deployment get "$DEP" --json | jq -r '.status')
[ "$STATUS" = "done" ] || { echo "deploy failed"; exit 1; }
```

Branch on the exit-code contract:

```bash
if ! nixploy app get "$APP" >/dev/null 2>&1; then
  case $? in
    3) echo "no such app, or the key lacks access" ;;
    2) echo "bad invocation" ;;
    *) echo "panel error" ;;
  esac
fi
```

Promote env from staging to production:

```bash
nixploy env export --scope environment --project-id "$P" --env staging -o /tmp/staging.env
nixploy env import -f /tmp/staging.env --scope environment --project-id "$P" --env production
nixploy app redeploy "$APP"
```

Nightly backup verification:

```bash
nixploy backup list --type postgres --service-id "$PG" --quiet \
  | xargs -n1 -I{} nixploy backup verify {} --json \
  | jq -e '.ok' > /dev/null || echo "a dump failed verification"
```

## Capabilities and key scopes

Every command runs with **the key's scope ∩ the key owner's capabilities**
(`nixploy auth whoami` lists the effective set). Anything outside it answers
HTTP 403, which the CLI reports with exit code `3`:

```text
Error (HTTP 403): This action requires the "domains.manage" capability
Error (HTTP 403): This action requires the "project.write" capability, outside this API key scope (read)
```

Pick the narrowest scope the automation needs when you create the key:

| Scope | Good for |
| --- | --- |
| `read` | `list` / `get` commands, `doctor`, dashboards |
| `deploy` | CI: `app deploy`, `redeploy`, `start`, `stop`, `restart` |
| `write` | config pushes: `env set`, `domain add`, `app update-source`, `gitops apply` |
| `admin` | `server`, `registry`, `ssh-key`, `org invite`, `updates apply` |

The catalog, the role ladder and the scope table are in [auth.md](./auth.md)
and [api.md](./api.md); each REST operation also advertises its requirement as
`x-nixploy-capability` in the OpenAPI spec.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `No API key configured` (exit 2) | No profile and no `NIXPLOY_API_KEY`. Run `nixploy auth login`. |
| `Request failed with status 404` on a command that used to work | Panel/CLI major mismatch. `nixploy doctor` compares the versions. |
| Exit 3 on everything | Key revoked or expired, or it belongs to another organization — check `nixploy org current`. |
| `Environment variables are redacted` | The key's user lacks `secrets.read`; values are hidden, key names are not. |
| A destructive command exits 2 without doing anything | It needs `--yes`. |
