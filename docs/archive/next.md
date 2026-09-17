# What we do next — Phase 10

**Rule:** ship the four product tracks below. Do **not** pull in SSO/SCIM,
Stripe billing, build-server role, Redis queue, or Kubernetes.

Working checklist for Phase 10. Phases 1–9 are done (see [`PLAN.md`](../../PLAN.md)).

---

## North star

1. **Permissions** — admins can grant/revoke capabilities without inventing roles.
2. **Tags** — label and filter services in the project UI.
3. **AI compose** — generate a compose YAML draft from a prompt (user saves; never auto-deploy).
4. **CLI** — compose/template commands match the REST surface; docs match the code.

---

## Sprint order

| Sprint | Focus | Done when |
| --- | --- | --- |
| **A** | Granular capabilities | `assertCapability`; member overrides; hot-path gates; UI toggles |
| **B** | Tags UI | M2M + `tag` router + chips/filter on project services |
| **C** | AI compose | `ai.generateCompose` + preview/save in compose create/file tab |
| **D** | CLI depth | compose create/redeploy/logs/env; template one/deploy flags; README |

```bash
pnpm -F @nixploy/server exec tsc --noEmit
cd apps/web && pnpm exec tsc --noEmit
pnpm -F @nixploy/cli typecheck   # when touching CLI
pnpm test
pnpm exec biome check --write <changed files>
```

---

## Sprint A — Granular permissions

- [x] Capability set + role → default map
- [x] Per-member overrides (DB)
- [x] `assertCapability` / `hasCapability`
- [x] Gate secrets, deploy, servers, invites
- [x] Organization → Members capability UI
- [x] Docs (`auth.md`) + capability denial tests

## Sprint B — Tags UI

- [x] Join tables for application / compose / databases
- [x] `tag` router (CRUD + assign + filter)
- [x] Service chips + project filter UI

## Sprint C — AI compose generation

- [x] `ai.generateCompose` (validate YAML; no auto-deploy)
- [x] UI: Generate with AI → preview → save
- [x] Unit test validation path

## Sprint D — CLI compose / template

- [x] Compose: create, redeploy, logs, env
- [x] Template: one, deploy with env/domain flags
- [x] CLI README + getting-started sync

---

## Explicitly later

SSO/OIDC, SCIM, Stripe, build-server role, Redis queue, Kubernetes,
new notification providers, new template categories.
