# Docs index

Guides for running and developing Nixploy.

**Human-friendly product docs (sidebar, API catalog):** [nixploy.com/docs](https://nixploy.com/docs) · [nixploy.com/api](https://nixploy.com/api)

## Start here

| Guide | Audience | What it’s for |
| --- | --- | --- |
| [install.md](./install.md) | Operators | Production one-liner, env overrides, update, troubleshooting |
| [getting-started.md](./getting-started.md) | Operators | First deploy (whoami / template), Git, CLI |
| [api.md](./api.md) | Operators / CI | REST conventions, router catalog, CLI, Swagger, MCP pointer |
| [mcp.md](./mcp.md) | Operators / AI | MCP server tools, auth, client config |
| [migrate-from-coolify.md](./migrate-from-coolify.md) | Operators | Concept map + cutover from Coolify |
| [migrate-from-dokploy.md](./migrate-from-dokploy.md) | Operators | Concept map + cutover from Dokploy |

## Product / ops deep dives

| Guide | What it’s for |
| --- | --- |
| [architecture.md](./architecture.md) | Monorepo layout, tenancy, request surfaces |
| [deployment-flow.md](./deployment-flow.md) | Queue → build → Swarm → Traefik · previews · fork gate |
| [domains-traefik.md](./domains-traefik.md) | Domains, TLS, traefik.me vs Let’s Encrypt |
| [auth.md](./auth.md) | better-auth, orgs, roles, **capabilities**, API keys, 2FA |
| [audit.md](./audit.md) | Audit log + role gates |
| [docker.md](./docker.md) | Docker control center / daemon ops |
| [observability.md](./observability.md) | Metrics, logs, incidents, uptime |
| [instance-backup.md](./instance-backup.md) | Instance self-backup (DB + config), restore, Redis |
| [templates.md](./templates.md) | Adding and validating compose templates |

## Feature checklist (shipped)

Use this against the marketing site / README when docs drift:

- [x] Deploy: multi-git, image, zip, builders, queue, rollback, PR previews + fork gate  
- [x] Databases + S3 backups + volume backups + instance backup  
- [x] Traefik domains / LE / custom certs / redirects / basic-auth  
- [x] Observability: logs, metrics history, terminal, alerts, uptime, incidents  
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
| [next.md](./next.md) | Polish / organize backlog |
| [hardening.md](./hardening.md) | Security / tenancy / cost backlog |
| [AGENTS.md](../AGENTS.md) | Repo conventions |

## Also see

- Product blueprint: [`../PLAN.md`](../PLAN.md)
- Marketing: [nixploy.com](https://nixploy.com) · [Features](https://nixploy.com/features) · [Docs](https://nixploy.com/docs) · [API](https://nixploy.com/api)
