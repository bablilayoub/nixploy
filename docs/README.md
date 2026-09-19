# Docs index

Guides for running and developing Nixploy.

**Human-friendly product docs (sidebar, API catalog):** [nixploy.com/docs](https://nixploy.com/docs) · [nixploy.com/api](https://nixploy.com/api)

## Start here

| Guide | Audience | What it’s for |
| --- | --- | --- |
| [install.md](./install.md) | Operators | Production one-liner, env overrides, update, troubleshooting |
| [releases.md](./releases.md) | Maintainers | Cut PaaS GitHub Releases (`v*`), GHCR tags, pinned install assets |
| [getting-started.md](./getting-started.md) | Operators | First deploy (whoami / template), Git, CLI |
| [api.md](./api.md) | Operators / CI | REST conventions, responses, capabilities per endpoint, typed client, Swagger |
| [cli.md](./cli.md) | Operators / CI | `@nixploy/cli`: auth & profiles, every command group, exit codes, scripting |
| [gitops.md](./gitops.md) | Operators / CI | `nixploy.yaml` v2 reference: shape, keys, what apply checks, what the file never carries |
| [mcp.md](./mcp.md) | Operators / AI | MCP server tools (41), annotations, prompts, resources, auth, client config |
| [migrate-from-another-panel.md](./migrate-from-another-panel.md) | Operators | Concept map + cutover from another self-hosted panel |

## Product / ops deep dives

| Guide | What it’s for |
| --- | --- |
| [architecture.md](./architecture.md) | Monorepo layout, tenancy, request surfaces |
| [deployment-flow.md](./deployment-flow.md) | Queue → build → Swarm → Traefik · previews · fork gate |
| [domains-traefik.md](./domains-traefik.md) | Domains, TLS, traefik.me vs Let’s Encrypt |
| [auth.md](./auth.md) | better-auth, orgs, roles, **capabilities**, API keys, 2FA |
| [hardening.md](./hardening.md) | Tenant network segmentation, container defaults, database external ports |
| [audit.md](./audit.md) | Audit log + role gates |
| [docker.md](./docker.md) | Docker control center / daemon ops |
| [observability.md](./observability.md) | Metrics, logs, incidents, uptime |
| [instance-backup.md](./instance-backup.md) | Backups: destinations (S3 / local disk), run history, restore verification, instance self-backup + manual restore, Redis |
| [templates.md](./templates.md) | Adding and validating compose templates |
| [audits/2026-09/](./audits/2026-09/README.md) | Improvement audit (security, architecture, product gaps, ops/DX, code health, UX) with a sequenced plan |

## Feature checklist (shipped)

Use this against the marketing site / README when docs drift:

- [x] Deploy: multi-git, image, zip, builders, queue, rollback, PR previews + fork gate  
- [x] Databases + backups (S3 or local disk) with run history + restore verification, volume backups, instance backup  
- [x] Traefik domains / LE / custom certs / redirects / basic-auth
- [x] External upstreams (front an origin outside the Swarm; flip DNS once during a migration)  
- [x] Observability: logs, metrics history, terminal, alerts, uptime, incidents, per-service event timeline  
- [x] Orgs, roles, capabilities, 2FA, audit, notifications (many channels)  
- [x] REST + Swagger + CLI + GitOps + MCP  
- [x] Deploy Copilot (explain / chat / generate compose)  
- [x] Remote Swarm servers, Docker control center, registries, schedules, updates  
- [x] 86+ templates  

## Contributors

| Guide | What it’s for |
| --- | --- |
| [**CONTRIBUTING.md**](../CONTRIBUTING.md) | Clone → run → PR checklist |
| [development.md](./development.md) | Local setup, env, verification loop |
| [codebase-map.md](./codebase-map.md) | File-level map: entry points, routers → modules, on-disk layout, env vars, crons |
| [status.md](./status.md) | Living snapshot: health checks, dependency upgrade candidates, known debt, backlog, session log |
| [roadmap.md](./roadmap.md) | What we build next and why: the competitive plan, sequenced into releases |
| [archive/next.md](./archive/next.md) | Phase 10 checklist (done) |
| [archive/hardening.md](./archive/hardening.md) | Phase 9 engineering checklist (done) — isolation lives in [hardening.md](./hardening.md) |
| [AGENTS.md](../AGENTS.md) | Repo conventions |
| [CLAUDE.md](../CLAUDE.md) | Claude Code entry point: commands, hard rules, gotchas |

## Also see

- Product blueprint: [`../PLAN.md`](../PLAN.md)
- Marketing: [nixploy.com](https://nixploy.com) · [Features](https://nixploy.com/features) · [Docs](https://nixploy.com/docs) · [API](https://nixploy.com/api)
