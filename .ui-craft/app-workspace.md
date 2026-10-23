# Focused actual app — verification and feature map

The public Mobbin-reference website remains as approved. This pass rebuilds the
actual platform with the existing shadcn/ui component system. The user confirmed
“exclusively shadcn/ui components”; the quiet monochrome workspace remains, with
all remaining native/custom controls standardized on those primitives. Editors,
charts and terminals retain their specialized engines inside shadcn surfaces.
No new dependency, backend API, migration, data model or encryption setting.

| Family | Preserved capabilities | Presentation |
|---|---|---|
| Shell and projects | Organization switch, capability filtering, command palette, profile/theme, connection/deploy/activity feedback, projects/environments/tags/upstreams/GitOps/recovery | Quiet sidebar, compact summary and project/service tables |
| Application | Every source/provider and builder, uploads, resources, deploy/ref/start/stop/Copilot, canonical service tabs and aliases | Focused Source / Build / Resources, primary Deploy and labelled Actions menu |
| Compose | Stored/repository files, editor, deployment/network/isolation flags, lifecycle commands, previews, schedules, mounts and rollback | Focused Source / Deployment / Lifecycle commands, shared draft retained |
| Five databases | Identity, version/upgrade safeguards, credentials, external access, connections, runtime, backups where supported, environment, settings | Focused Identity / Engine / Credentials / External access |
| Service tools | Logs, metrics, events, terminal, retained logs, domains, env import/export/inheritance, backups, previews, schedules, all advanced categories, move/duplicate/delete | Consistent navigation, library controls and open form sections |
| Operations | Docker containers/images/Swarm/networks/volumes/system, migration import/review, schedules, templates/filter/detail/deploy | Shared table/dialog language, every existing API binding retained |
| Monitoring | Fleet/incident/audit navigation, host health, per-service metrics, alerts, logs, Prometheus | Focused views and searchable mobile service picker; invalid non-admin alerts links recover to metrics |
| Account/organization | Name/avatar, password/passkeys/2FA/sessions, API/MCP; branding, quotas, shared env, members/roles/capabilities/teams/security/delete | Focused sections with persistent local drafts, independent limits/shared-variable destinations |
| Platform/integrations | Servers/SSH/certs/Git/registries/storage/template sources; routing/DNS/proxy/egress/health/maintenance/updates/AI/users/SSO/branding | Open form layouts; legacy hashes and contextual links reach the right task |
| Public/auth/failure | Login, reset/forgot password, 2FA, setup, invitations, status, maintenance, docs API, forbidden/not-found/error/retry | Quiet authentication shell, light/dark/system preserved |

## Product previews

Actual production fixture screens; these contain demo records, not user data.

[Light workspace](../docs/images/app-workspace-light.png) ·
[Dark workspace](../docs/images/app-workspace-dark.png)

## Evidence and limits

Private reproducible evidence lives under
`.nixploy-data/verification/app-rebuild/` (ignored; includes fixture cookies).
All ordinary visual checks use isolated fixture Postgres on 59580, never the live
primary database on 54329. The first-run check uses a separate disposable setup
DB. Source/build variants restore their original fixture fields in `finally`.

- 392 production route/theme captures: canonical routes, old aliases, service
  kinds/tabs/sub-tabs/advanced categories, settings, focused hashes, monitoring
  views and public/auth routes. No page/hydration errors, document overflow or
  unnamed visible controls detected.
- 408 responsive captures: 34 families × 320/390/768px × 100/200% text × 2 themes.
- 216 dialog captures: 36 workflows ×3 viewports × 2 themes. Six initial startup
  connection refusals were retried after readiness; all verified cases pass.
- 18 template wizard steps, 12 isolated real error-boundary/reset/theme checks,
 16 final controls/deep links/role-display cases and 56 source/build variants.
- First-run welcome/owner/organization/review/complete flows and empty dashboard
  completed in the dedicated setup DB. Test selectors were scoped after the
  first harness matched both Projects headings; no application failure/reset.
- Dirty navigation cancel/discard, filter empty/reset, offline/reconnect,
  reduced motion and query loading/error/retry pass in both modes.
- Independent design and a 11y reviews closed all actionable findings.74 mobile
  section visits, all six draft families in both themes, keyboard/modal focus,
  hashes, picker search and enlarged text were checked. WCAG contrast calculations
  are a fallback, not a complete screen-reader certification.
- Source inventory preserves all 582 tracked existing query/mutation/key bindings across
 380 visual/support sources. The unused SectionLinks helper is replaced by
  FocusSections. This is a preservation guard, not proof from a count alone.
- Web production build/typecheck, strict workspace Biome, knip, 119 web tests and
 3, 353 server tests pass (137 optional server tests skipped). A deterministic
 scan of the five new/shared compositions has no findings; independent rendered
 reviews cover the broader design.

Production rollout must retain the original environment, config directory,
existing DB, encryption keys and all-role custom server. Back up before switching,
verify all 72 tables/240 rows and 62 config files, and keep the older build available.
`platform-alerts.json` is a periodically refreshed health report; compare current
state across restart rather than rolling that live report back to an older hash.

## Live verification

The final all-role custom server runs on 3000 from `.next-shadcn-release`; health and
readiness return 200. Restart hashes match all 72 tables/240 rows and 62 files, plus
the original Desktop environment/type files. The private custom-format database
backup was verified with `pg_restore --list`; no primary restore/reset/seed or
migration ran. Original keys, runtime environment and data/config paths remain.
Existing-session checks pass in light and dark. Later browser reads change only
`web_server_settings.metrics_config.webServer.updateLastCheckedAt`, confirmed
field-by-field against backup COPY rows. All other user settings/data and config
hashes remain. The earlier Mobbin build is retained for rollback.

## Confirmed shadcn/ui component contract — 2026-10-23

The user clarified that “fully ChatGPT” meant **exclusively shadcn/ui components**.
The actual app now has no native button/input/select/textarea/table/disclosure/label
markup outside `components/ui`. All consumers use the existing primitives. Added
shadcn Radio Group and Collapsible source on the already-installed Radix dependency;
no package or lockfile changes. Specialized CodeMirror, Recharts and xterm engines
remain inside the shared UI surfaces to preserve editing, charts and terminals.

Builder choices now use a labelled radio group; migration selectors retain cascading
selection, the empty target's auto-match semantics, disabled states and stale-plan
revision guards. GitOps uses Checkbox. File and color inputs use Input; templates,
service actions, Docker links and filters use Button; both remaining data tables use
Table. Disclosures have visible chevrons and retain local drafts while closed content
stays hidden. The migration table has one bounded scrolling container so its headings
stay visible during review.

Correction verification (separate from the broader rebuild evidence above):

- 104 production route/control captures across desktop/mobile and both themes;
  no hydration/page errors, unnamed visible controls or document overflow detected.
- Four migration sequences at 1440/320px in both themes, including 200% text,
  source project/environment cascade, target auto-match, sticky headers and late-plan
  discard. Browser-only inspect/plan responses; no external import or apply request.
- 28 focused controls checks: tag/branding color fields, GitOps checkbox and local
  file reading, zip/env/branding file-picker wiring, inherited-variable disclosure,
  Copilot suggestions. Copilot and inherited values use browser-only responses;
  no model request, branding upload, import, deploy or settings save is submitted.
- 18 template wizard steps and 12 real boundary/theme/reset cases pass.
- The 582 tracked API bindings are unchanged across 382 visual/support sources.
  Typecheck, production build, strict Biome (1,196 files), knip, 119 web tests and
  3,353 server tests pass (137 optional server tests skipped). Independent design
  and accessibility review findings are resolved and rendered checks cover the fixes.

Private receipts/backups: `.nixploy-data/verification/shadcn-components/`.
The primary restart matches all 72 tables/240 rows, 62 config files and original
settings/environment files. Existing-session verification passes (12 route/control
and two saved-service theme checks). Subsequent reads advance only the automatic
`webServer.updateLastCheckedAt` field. Original encryption keys/config paths and the
all-role custom server remain. The previous `.next-app-ship` build is retained;
there was no primary seed/reset/restore/migration. The public website stays on 3373.
