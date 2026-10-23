# Actual app — Vercel structure with native shadcn/ui

The user rejected the previous theme-only correction and asked for a full app
rebuild with Vercel-style structure and native shadcn components. The current
implementation changes the compositions while retaining the official New York/
Zinc palette, primitive styles, Geist typefaces and all existing feature wiring.
No new dependency, server API, schema, migration or encryption change.

## Rebuilt compositions

- Workspace: branded organization header, native Navigation Menu route links,
  command search/account/theme controls, and a native Sheet menu on mobile. The
  old permanent desktop sidebar is replaced. Docs/support links remain reachable.
- Projects: searchable Card collection with environment links, truthful service
  health, counts and creation times. Workspace metrics, deployment activity/trends
  and setup guidance remain available below the collection.
- Services: contextual header and canonical service tabs, then a desktop vertical
  task rail for application/Compose/database configuration. Mobile uses a named
  Select. Panels stay mounted and local drafts survive section changes.
- Settings: dedicated grouped settings navigation, wider content area, consistent
  Cards, related-task tabs, and clear action footers. Contextual hashes remain.
- Data tools: native Card/Header/Content/Footer compositions for shared tables,
  toolbars and pagination; native segmented Tabs for nested operational workspaces.
- Templates: native Cards for identity, requirements, descriptions and actions,
  retaining filters, external links, details and the full deployment wizard.
- Auth: centered semantic forms across login, forgot/reset password, 2FA, invitations
  and all setup steps. Standard shadcn controls and error messages remain. The old
  outer Card around every auth form is removed.
- States: shared query failures use the native Empty component with retry; loading
  placeholders are width-bounded. Operational editors/charts/terminals retain their
  engines inside the shared UI system.

| Family | Preserved capabilities | Presentation |
|---|---|---|
| Shell and projects | Organization switch, capability filtering, command palette, profile/theme, connection/deploy/activity feedback, projects/environments/tags/upstreams/GitOps/recovery | Workspace header, project cards and mobile Sheet |
| Application | Every source/provider and builder, uploads, resources, deploy/ref/start/stop/Copilot, canonical service tabs and aliases | Focused Source / Build / Resources, primary Deploy and labelled Actions menu |
| Compose | Stored/repository files, editor, deployment/network/isolation flags, lifecycle commands, previews, schedules, mounts and rollback | Focused Source / Deployment / Lifecycle commands, shared draft retained |
| Five databases | Identity, version/upgrade safeguards, credentials, external access, connections, runtime, backups where supported, environment, settings | Focused Identity / Engine / Credentials / External access |
| Service tools | Logs, metrics, events, terminal, retained logs, domains, env import/export/inheritance, backups, previews, schedules, all advanced categories, move/duplicate/delete | Consistent navigation, library controls and open form sections |
| Operations | Docker containers/images/Swarm/networks/volumes/system, migration import/review, schedules, templates/filter/detail/deploy | Shared table/dialog language, every existing API binding retained |
| Monitoring | Fleet/incident/audit navigation, host health, per-service metrics, alerts, logs, Prometheus | Focused views and searchable mobile service picker; invalid non-admin alerts links recover to metrics |
| Account/organization | Name/avatar, password/passkeys/2FA/sessions, API/MCP; branding, quotas, shared env, members/roles/capabilities/teams/security/delete | Focused sections with persistent local drafts, independent limits/shared-variable destinations |
| Platform/integrations | Servers/SSH/certs/Git/registries/storage/template sources; routing/DNS/proxy/egress/health/maintenance/updates/AI/users/SSO/branding | Open form layouts; legacy hashes and contextual links reach the right task |
| Public/auth/failure | Login, reset/forgot password, 2FA, setup, invitations, status, maintenance, docs API, forbidden/not-found/error/retry | Quiet authentication shell, light/dark/system preserved |

## Evidence and limits

Private reproducible receipts and backups live under
`.nixploy-data/verification/vercel-native/` (ignored). All ordinary browser checks
use the isolated Postgres fixture on port 59580. First-run setup uses the separate
`nixploy_fieldwork_vercel_setup` database there, never the primary on 54329.

Current coverage: route/theme sweep, responsive layouts, dialog workflows, keyboard/
focus/navigation, full template setup, existing control behavior, query failures,
offline/reconnect and dirty-navigation cancel/discard. Tests use browser-only
response fixtures for external import planning and AI suggestions; no import,
deploy, external model call or user settings save is submitted. All 606 tracked
query/mutation/key source occurrences match the pre-correction commit.

Review caught a clipped service rail caused by nested Tabs height selectors and
route links incorrectly given tab semantics. Intrinsic rail sizing and native
Navigation Menu links address those findings. Geometry checks assert every rail
entry is actually inside the visible rail; checking element existence alone is
insufficient. Auth checks now target the new form rather than an obsolete Card.

[Light app preview](../docs/images/app-workspace-light.png) ·
[Dark app preview](../docs/images/app-workspace-dark.png)

Production builds, typecheck, strict Biome, knip, web/server tests and rendered
checks must pass before the live switch. Browser coverage is not a full screen-
reader certification or a deployment of every service/source combination. Preserve
the original runtime environment, data/config paths, database and encryption keys.
Back up before the graceful switch, compare all table/settings/config hashes and
retain the old build for rollback. The public website on 3373 is outside this app
composition correction.

The shared TableCard keeps the same Card and Header mounted when data finishes
loading and framing changes. A regression check holds real service queries, opens
the tag dialog, edits its name/color, releases the queries, and verifies the dialog
and unsaved values survive. No tag is saved. Loading/error/retry is also checked
at 320px with 200% text.

## Verification receipts

Verification for the rebuild includes 392 route/theme captures, 408 responsive
cases, 68 additional tablet cases, 216 dialogs, 104 selected routes/controls, 28
focused controls, four migration sequences, 18 template steps, 16 deep-link/role
cases, 12 real boundaries, six login and 12 navigation cases. Final fixes receive
targeted rechecks. Four held-query transition cases preserve open tag dialogs and
drafts. All five first-run steps complete in the dedicated setup DB. Production
build/typecheck, strict Biome (1,196 files), knip, 119 web tests and 3,353 server
tests pass (137 optional server tests skipped).

The running build is `.next-vercel-live` on 3000. Its restart compares all 72
tables/240 rows, 62 config files and original settings/environment files against
the backup. The previous `.next-vercel-final` and `.next-stock-ship` builds remain
available. Main landmarks, native route-link semantics and visible active route
state are covered by the final navigation checks. The first live check still used
the removed sidebar's main landmark; the shell now renders its own semantic Main.

[Light service configuration](../docs/images/app-service-light.png) ·
[Dark service configuration](../docs/images/app-service-dark.png)

Final existing-session checks pass 12 route/control and two saved-application
cases in both themes. Post-read verification preserves every other table/config
hash; only the automatic `webServer.updateLastCheckedAt` field advances. Original
environment/type files and stored user settings remain unchanged. The live server
is ready on 3000, the website returns 200 on 3373, and test listeners are stopped.
