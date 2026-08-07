# Getting started

After [install](./install.md), this is the shortest path to a real deploy.

## 1. Owner setup

Open the Setup URL from the installer. Create the first user — that creates an
organization (`Your Name's Org`). Public registration stays off afterward;
invite teammates from **Settings → Organization**.

## 2. Deploy something trivial

**Option A — Docker image**

1. Dashboard → New project (or open the default)
2. New application → source **Docker image** → `traefik/whoami:v1.10.1`
3. Domains → add `whoami.<your-domain>` (or a `*.traefik.me` host for a quick
   local smoke — no Let's Encrypt on traefik.me)
4. Deploy → watch live logs

**Option B — Template**

Templates → pick something small (e.g. WordPress or Uptime Kuma) → deploy
sheet → Destination → Configure → Domain.

## 3. Wire Git

Settings → Git Providers → connect GitHub/GitLab/…  
On the app: source type Git, enable auto-deploy, optionally Preview
Deployments for PRs.

## 4. API / CLI

Settings → Profile → API key:

```bash
npm i -g @nixploy/cli
nixploy auth login --url https://panel.yourdomain.com --api-key nxlp_...
nixploy doctor
nixploy app list --project-id <id>
nixploy compose list --project-id <id>
nixploy template list
```

Swagger lives at `/swagger` on your panel.

## 5. Optional power features

| Feature | Where |
| --- | --- |
| Deploy Copilot | Settings → Server → AI; explain on Deployments |
| Placement | Application → Advanced → Placement |
| GitOps | Project → GitOps (export / URL sync) |
| Notifications | Settings → Notifications |
| Remote servers | Settings → Servers |

## Next reading

- [Install](./install.md)
- [Migrate from Dokploy](./migrate-from-dokploy.md) /
  [Coolify](./migrate-from-coolify.md)
- [Domains & Traefik](./domains-traefik.md)
- [Deployment flow](./deployment-flow.md)
- [Architecture](./architecture.md)
