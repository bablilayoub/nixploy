# GitOps — `nixploy.yaml` reference

One project environment as a file: export it, keep it in git, `plan` it against the live panel, `apply` it. Version 2 of the file covers the whole service surface — hooks, Swarm overrides, mounts, published ports, redirects, basic auth, domain middlewares, preview settings — and names the rows a service references (registry, server) instead of storing ids, so the same file applies on another instance.

The panel UI is Project → GitOps. The CLI is `nixploy gitops export`, `nixploy plan -f`, `nixploy apply -f`, `nixploy gitops sync-url --url`. The API is the `gitops` router (`exportStack`, `plan`, `runApply`, `syncFromGit`, `syncFromUrl`; see [api.md](./api.md)).

## Three rules

1. **An omitted scalar means "leave as is"**, never "reset to the default". A file that lists only `repository` and `branch` changes only those two columns.
2. **An array is the whole desired set.** `domains`, `mounts`, `ports`, `redirects`, `basicAuth` and a domain's `middlewares` are reconciled by key: rows the file lists are created or patched, rows it does not list are deleted. `[]` removes every row; an **omitted** array leaves the rows alone.
3. **Values never enter the file.** Env is exported as key names only. Basic-auth passwords are write-only. Hook commands, inline compose files and file-mount contents are exported only to a caller holding `secrets.read`, and applying a file that carries them needs `secrets.write`.

## Versions

`version: 2` is current. A `version: 1` file is still accepted and upgraded on read; the one semantic difference is that v1 read an omitted `domains` as "no domains" and deleted the live rows, so the upgrader spells `domains: []` out on every v1 service that left it out — a v1 file keeps doing exactly what it did. Export always writes v2.

## Shape

```yaml
version: 2
project:
  name: shop
  slug: shop          # optional; export writes it, apply matches by name first
environment:
  name: production
applications:
  - name: api
    environment: production
    appName: api-3f9a1c            # immutable after the first deploy
    sourceType: github             # docker | git | github | gitlab | bitbucket | gitea | drop
    repository: acme/api
    owner: acme
    branch: main
    buildType: dockerfile          # dockerfile | nixpacks | railpack | heroku_buildpacks | paketo_buildpacks | static
    dockerfile: Dockerfile
    dockerContextPath: .
    dockerBuildStage: null
    useBuildCache: true
    replicas: 2
    command: null
    memoryLimit: 512M
    cpuLimit: "1.0"
    autoDeploy: true
    watchPaths: ["src/**", "package.json"]
    registry: null                 # pull registry, by its name in Settings → Registries
    pushRegistry: ghcr             # by name; the registry needs an image prefix
    server: null                   # placement, by server name; null is the primary
    hooks:                         # secrets.write to apply, secrets.read to export
      preDeploy: npm run migrate
      postDeploy: null
    swarm:                         # raw ServiceSpec fragments, same shape as application.update
      restartPolicy: { Condition: on-failure, MaxAttempts: 3 }
      updateConfig: { Parallelism: 1, Order: start-first }
      labels: { team: shop }
      # network / privileges are instance-admin only
    previews:
      enabled: true
      forksRequireApproval: true
      limit: 3
      ttlHours: 48
    envKeys: [DATABASE_URL, SESSION_SECRET]   # names only, never values
    domains:
      - host: api.acme.dev
        path: /
        port: 3000
        https: true
        certificateType: letsencrypt   # letsencrypt | none | custom
        internalPath: null
        middlewares:                   # the whole chain, in order
          - kind: rateLimit
            config: { average: 100, burst: 200 }
          - kind: headers
            config: { stsSeconds: 31536000 }
            enabled: true
    mounts:
      - type: volume                   # bind | volume | file
        mountPath: /var/lib/api
        volumeName: api-3f9a1c-data    # must be scoped to the appName
      - type: file
        mountPath: /etc/api/config.yml
        filePath: config.yml
        content: |                     # secrets.write to apply; omit to keep what is stored
          debug: false
      # type: bind + hostPath is instance-admin only
    ports:
      - published: 9100
        target: 9100
        protocol: tcp                  # tcp | udp
        publishMode: ingress           # ingress | host
    redirects:
      - regex: ^/old-docs
        replacement: /docs
        permanent: true
    basicAuth:
      - username: metrics
        password: change-me            # required when the entry is new; omit afterwards
compose:
  - name: monitoring
    environment: production
    composeType: docker-compose        # docker-compose | stack
    sourceType: raw                    # raw | git | github | gitlab | bitbucket | gitea
    composeFile: |                     # raw sources only; exported with secrets.read
      services: …
    buildEnabled: false
    publishPorts: false                # turning it on is instance-admin only
    isolatedDeployment: false
    hooks: { preDeploy: null, postDeploy: null }
    previews: { enabled: false, forksRequireApproval: true, limit: 3, ttlHours: null }
    domains:
      - host: grafana.acme.dev
        serviceName: grafana           # which container of the stack
        https: true
        certificateType: letsencrypt
    mounts:                            # serviceName is required on every compose entry
      - type: volume
        mountPath: /var/lib/grafana
        volumeName: monitoring-9c1d2e-grafana
        serviceName: grafana
    redirects: []
    basicAuth: []
databases:
  postgres:
    - name: main
      environment: production
      dockerImage: postgres:17
      databaseName: shop
      databaseUser: shop
      externalPort: null
      memoryLimit: 1G
      server: null
```

Keys: a domain is matched on `host` + `path` + `port`; a mount on `mountPath` (plus `serviceName` for compose); a port on `published` + `protocol`; a redirect on `regex` (plus `serviceName`); a basic-auth entry on `username` (plus `serviceName`). Renaming a key deletes the old row and creates a new one.

## What apply checks

Apply is the same funnel the panel forms use, so a file cannot attach what the form refuses:

- `gitops.manage` always; `service.create` (and the service quota) for every service the plan creates; `service.write` for any update or child-row change; `service.deploy` when the changed applications and stacks are redeployed (default; `redeploy: false` / `--no-redeploy` skips it).
- `secrets.write` when the file carries hook commands, basic-auth passwords or file-mount contents.
- The **instance admin** for bind mounts, `swarm.network`, a `swarm.privileges` block that relaxes the container hardening, and `publishPorts: true` on a stack — the same gates as the UI, and they apply even when the row already has the value.
- Mounts, redirect rules, middleware configs (per kind), `forwardAuth` targets and `nixployAuth` team/user ids are validated exactly as their routers validate them.

Every service is applied independently: one that fails is reported with its reason on its item and in `errors`, the rest of the file is still written, and failed items are never redeployed. A service's domain rows and middleware chains are reconciled in one transaction; mounts, ports, redirects and basic auth follow, then Traefik is rewritten once and, for applications, the Swarm service is re-specified when its mounts, ports, resources or Swarm overrides changed. A stack whose mounts changed is redeployed (its file is rendered at deploy time).

## Moving the values: the secrets bundle

The manifest carries env as key names. The values travel separately, sealed with a passphrase you type on both sides:

```bash
# on the source instance
export NIXPLOY_SECRETS_PASSPHRASE='correct horse battery staple'   # 12 characters minimum
nixploy gitops export --project-id proj_123 --env production -o nixploy.yaml
nixploy gitops export-secrets --project-id proj_123 --env production -o production.secrets

# on the target instance (project and environment created first)
nixploy apply -f nixploy.yaml --project-id proj_456 --secrets production.secrets
```

`apply --secrets` writes the manifest, then the values, then redeploys — one call, and the services come up with their env. `nixploy gitops apply-secrets --project-id … --env … -f production.secrets` does the second step on its own (it does not deploy; the values reach a container on the next deploy). The passphrase comes from `--passphrase-file` or `NIXPLOY_SECRETS_PASSPHRASE`, never from an argument.

The bundle holds the env of the project, the environment and every service **by name** (the same key the manifest uses), plus each application's and stack's build args and preview env — the columns the panel redacts behind `secrets.read`. Exporting needs `secrets.read`, applying needs `secrets.write`; a wrong passphrase is refused before anything is written, and a service the bundle names that the target does not have is reported under `missing` rather than created. The format is `nixploy-secrets:1:…` — scrypt with a fresh salt per bundle, AES-256-GCM with the version as additional data — so a bundle cannot be re-labelled and a wrong passphrase fails on the tag rather than producing garbage. Audit rows record counts of services and keys, never values.

Database **passwords** are deliberately not in the bundle: the running container was initialised with the stored one, and a row that says otherwise is a lie the next restore trips over.

## What the file does not carry

Registry credentials, certificates and their keys, database passwords, backups and schedules, notifications, and the deployment history. Domains of the `custom` certificate type keep the certificate they already reference.

## Round trip

`export` writes every scalar the row has (nulls included) and every array (empty included), so `export` → `apply` is a no-op plan. A hand-written file can be as short as a name and a branch. `plan` reports changes as manifest paths (`previews.limit`, `hooks.preDeploy`, `middlewares`) so a diff reads like the file.
