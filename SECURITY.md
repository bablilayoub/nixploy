# Security policy

Nixploy is a self-hosted PaaS that runs with root access to a Docker Swarm and
stores tenant secrets at rest. Please report vulnerabilities privately so
operators can update before details are public.

## Reporting a vulnerability

- Email **hello@nixploy.com** with a description, affected version(s), and
  reproduction steps or a proof of concept. Encrypt if you can; a plain email is
  fine.
- Do **not** open a public GitHub issue, discussion or pull request for a
  security problem.
- If you are unsure whether something is a security issue, report it anyway.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| Triage and severity (CVSS-style: critical / high / medium / low) | within 7 days |
| Fix for critical / high | next patch release, aiming for 14 days |
| Fix for medium / low | next scheduled release |
| Public disclosure | after the fix is released, within 90 days of the report at the latest — coordinated with you |

Fixed issues are called out in the GitHub Release notes. Reporters are
credited unless they ask not to be.

## Supported versions

Nixploy is pre-1.0 and ships from a single release channel. Only the **latest
release** (the `:latest` image tag that the in-app updater tracks) receives
security fixes; update with `update.sh` or Settings → Platform → Updates.

| Version | Supported |
| --- | --- |
| Latest `vX.Y.Z` release | yes |
| Older releases | no — upgrade |
| `main` / `<sha>` continuous images | best effort, not a release channel |

## Scope

In scope:

- The panel: `apps/web` and `packages/server` — UI, tRPC, REST (`/api/...`),
  MCP (`/api/mcp`), WebSocket streams, auth (better-auth, 2FA, API keys),
  tenancy and authorization, secrets at rest, deploy engine, Traefik
  configuration, backups, notifications.
- The production image (`docker/`) and the installer / updater
  (`install.sh`, `update.sh`).
- The CLI (`apps/cli`, `@nixploy/cli`).
- Built-in templates as shipped by Nixploy (defaults, generated env,
  network exposure).

Out of scope:

- Vulnerabilities in the applications, databases or third-party images an
  operator deploys through Nixploy, and in upstream software used by templates.
- Attacks that require owner/admin access to the same organization, or shell /
  root access to the host.
- Resource exhaustion of an operator's own instance (Nixploy has no
  multi-tenant isolation guarantees between untrusted operators on one host).
- The marketing site (`apps/landing`) except for issues that affect the
  documented install commands.

## Safe harbour

Good-faith research that follows this policy — no data exfiltration beyond
what is needed to demonstrate the issue, no service disruption of instances you
do not own, no social engineering — will not be pursued legally, and we will
work with you to understand and resolve the issue quickly.
