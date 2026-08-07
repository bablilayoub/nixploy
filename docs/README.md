# Docs index

Guides for running and developing Nixploy. Start here, then dive deep.

## Start here

| Guide | Audience | What it’s for |
| --- | --- | --- |
| [install.md](./install.md) | Operators | Production one-liner, env overrides, update, first-hour troubleshooting |
| [getting-started.md](./getting-started.md) | Operators | First deploy (whoami / template), Git, CLI |
| [api.md](./api.md) | Operators / CI | REST conventions, `x-api-key`, CLI, panel Swagger |
| [migrate-from-coolify.md](./migrate-from-coolify.md) | Operators | Concept map + cutover from Coolify |
| [migrate-from-dokploy.md](./migrate-from-dokploy.md) | Operators | Concept map + cutover from Dokploy |

## Product / ops deep dives

| Guide | What it’s for |
| --- | --- |
| [architecture.md](./architecture.md) | Monorepo layout, tenancy, request surfaces |
| [deployment-flow.md](./deployment-flow.md) | Queue → build → Swarm → Traefik |
| [domains-traefik.md](./domains-traefik.md) | Domains, TLS, traefik.me vs Let’s Encrypt |
| [auth.md](./auth.md) | better-auth, orgs, roles, API keys |
| [audit.md](./audit.md) | Audit log + role gates |
| [docker.md](./docker.md) | Docker control center / daemon ops |
| [observability.md](./observability.md) | Metrics, logs, incidents |
| [templates.md](./templates.md) | Adding and validating compose templates |

## Contributors

| Guide | What it’s for |
| --- | --- |
| [development.md](./development.md) | Local setup, env, verification loop |
| [next.md](./next.md) | **What we do next** — polish / organize / optimize (no new features) |
| [hardening.md](./hardening.md) | Phase 9 technical backlog with evidence + acceptance criteria |

## Also see

- Product blueprint: [`../PLAN.md`](../PLAN.md)
- Agent / contributor conventions: [`../AGENTS.md`](../AGENTS.md)
- Marketing site docs entry: [nixploy.com/docs](https://nixploy.com/docs)
- API overview: [nixploy.com/api](https://nixploy.com/api)
