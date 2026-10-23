# Actual app — native shadcn rebuild

Current requirements: monochrome, native shadcn components and Vercel-style restraint. Previous Fieldwork, Mobbin, Zinc and horizontal-shell compositions are retired. This pass replaces page structures and bespoke form/surface markup, preserving behavior and stored configuration.

## Composition and provenance

- Official [sidebar-07](https://ui.shadcn.com/blocks/sidebar) composition, with organization switching and contextual settings navigation. Collapsed-state cookie is respected; text enlargement switches to the native Sheet.
- Overview uses a compact project Item list beside deployment activity; no repeated large project Cards.
- Every service kind shares a new identity/action Card, canonical line Tabs and horizontal configuration Tabs. Draft panels stay mounted.
- Settings use a single content column, native Cards and Field groups. Shared table controls sit above their frame; pagination sits below.
- Auth uses the official [login-03](https://ui.shadcn.com/blocks/login) Card composition for every account state. Failure/not-found/maintenance use native Empty.
- Native Field/FieldLabel replace bespoke field wrappers throughout service, infrastructure, account and dialog forms. Native FieldLabel/RadioGroup compose builder choices; Progress renders host usage. Item, Field and Progress source comes from the official New York v4 registry.
- Official Neutral palette, with destructive and sidebar-primary roles using the existing neutral primary colors to meet the user's monochrome requirement. Engine chrome/ANSI palettes are grayscale. User branding, logos, avatars and tags remain stored features.
- No new dependencies, server APIs, schemas or encryption changes. All 624 normalized query/mutation/key call expressions match the prior revision.

## Feature coverage

| Family | Preserved capabilities | Presentation |
|---|---|---|
| Shell and projects | Organization switch, capability filtering, command palette, profile/theme, connection/deploy/activity feedback, projects/environments/tags/upstreams/GitOps/recovery | Native Sidebar, project Item list and mobile Sheet |
| Application | Every source/provider and builder, uploads, resources, deploy/ref/start/stop/Copilot, canonical service tabs and aliases | Focused Source / Build / Resources, primary Deploy and labelled Actions menu |
| Compose | Stored/repository files, editor, deployment/network/isolation flags, lifecycle commands, previews, schedules, mounts and rollback | Focused Source / Deployment / Lifecycle commands, shared draft retained |
| Five databases | Identity, version/upgrade safeguards, credentials, external access, connections, runtime, backups where supported, environment, settings | Focused Identity / Engine / Credentials / External access |
| Service tools | Logs, metrics, events, terminal, retained logs, domains, env import/export/inheritance, backups, previews, schedules, all advanced categories, move/duplicate/delete | Native Cards, Fields, Tables, Tabs and contained engine tools |
| Operations | Docker containers/images/Swarm/networks/volumes/system, migration import/review, schedules, templates/filter/detail/deploy | Shared table/dialog language, every existing API binding retained |
| Monitoring | Fleet/incident/audit navigation, host health, per-service metrics, alerts, logs, Prometheus | Focused views and searchable mobile service picker; invalid non-admin alerts links recover to metrics |
| Account/organization | Name/avatar, password/passkeys/2FA/sessions, API/MCP; branding, quotas, shared env, members/roles/capabilities/teams/security/delete | Focused sections with persistent local drafts, independent limits/shared-variable destinations |
| Platform/integrations | Servers/SSH/certs/Git/registries/storage/template sources; routing/DNS/proxy/egress/health/maintenance/updates/AI/users/SSO/branding | Native Field forms; legacy hashes and contextual links reach the right task |
| Public/auth/failure | Login, reset/forgot password, 2FA, setup, invitations, status, maintenance, docs API, forbidden/not-found/error/retry | Native login-03 Cards and Empty failure pages; light/dark/system preserved |

## Verification and limits

Private route, responsive, overlay, control, setup and rollout evidence: `.nixploy-data/verification/native-rebuild/`. Desktop route sweeps cover every app route family and public state in both themes. Enlarged-text fixes receive focused reruns. Independent design and accessibility reviewers rechecked their findings after fixes. Existing unit tests, typecheck, production build and strict Biome are required before switching the primary server.

Browser fixture data is isolated. Screenshots in README show example records. These checks are not a screen-reader certification or a new live deployment-engine smoke test; no deployment engine behavior changes. The separate pre-existing dependency security CI baseline remains documented in `docs/status.md`.

## Preservation

The primary database, config directory, encryption keys, environment, sessions and settings remain in place. A database dump and config-file backup precede rollout; compare hashes immediately after restart and perform read-only live checks. No primary reset, seed, restore or migration. PR 34 stays draft.

Final rollout: `.next-native-release` on localhost:3000; health/readiness200. All immediate restart hashes match 72 tables/240 rows and 62 config files. After live read-only checks only the automatic `webServer.updateLastCheckedAt` timestamp advances. Existing-session/project/service/settings/mobile checks pass. Database/config backups and the prior build remain available.
