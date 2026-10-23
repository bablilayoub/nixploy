# Actual app — stock shadcn/ui

The latest user instruction is authoritative: **pure shadcn, no custom theme**.
The actual app uses its existing New York/Zinc configuration, official light/dark
palette, radius scale, Card, Sidebar, Tabs, forms, menus and dialogs. Removed the
789-line Fieldwork stylesheet and its custom surface, navigation and auth skins.
This supersedes the previous app visual directions. The public Mobbin-reference
website remains unchanged in this correction.

No new dependency, server API, schema, migration or encryption change. Existing
branding settings remain available and stored values are preserved. Specialized
CodeMirror, Recharts and xterm engines remain inside shared shadcn surfaces.

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

## Stock components and compatibility

Restored 31 existing primitives from the official New York v4 registry. Theme
values come directly from the official Zinc `inlineColors` light/dark records:
[registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json),
[Zinc colors](https://ui.shadcn.com/r/colors/zinc.json).
Legacy semantic names alias stock tokens; they do not introduce another palette.

Preserved necessary behavior around those defaults: controlled-dialog focus
return, viewport-bounded confirmations, inert collapsed navigation, announced
validation, labelled sliders, reachable scrolling tabs, coarse-pointer targets,
mobile input text size, deterministic skeleton widths, sticky table headings,
reduced motion, scroll locking and wrapping under enlarged text. These safeguards
are not an alternate visual theme. Settings use default Card composition, section
navigation uses default Tabs, and authentication retains the standard Card.

## Product previews

Actual production fixture screens; demo records only, never user data.

[Light workspace](../docs/images/app-workspace-light.png) ·
[Dark workspace](../docs/images/app-workspace-dark.png)

## Verification and practical limits

Private reproducible evidence is ignored under
`.nixploy-data/verification/shadcn-defaults/`. Fixture checks use Postgres on
59580; first-run setup uses a separate database there. The primary database on
54329 is never reset, seeded, restored or migrated by this UI correction.

- 392 production route/theme captures cover canonical and legacy service tabs,
  settings, focused sections, monitoring and public/auth routes. No page/hydration
  errors, document overflow or unnamed visible controls detected.
- 408 responsive captures cover 34 families at 320/390/768px, 100/200% text and
  both themes. Additional populated migration and notification forms exposed
  narrow-width issues; their grid/text wrapping was corrected and retested.
- 216 dialog cases cover 36 workflows at desktop/mobile widths in both themes,
  including focus containment, Escape and focus return. The final production
  rerun includes the notification correction.
- 104 route/control captures check builder keyboard operation and draft retention,
  disclosures, file/color inputs, command palette and template details. Separate
  28-control, four migration-sequence, 18 template-step, 16 deep-link/role-display,
  12 real error-boundary and 14 accessibility/theme checks cover specific behavior.
- 16 header cases cover four widths, enlarged text and both themes. A visual check
  caught overlapping header tools that document-width checks alone did not; tools
  now wrap and the existing ResizeObserver updates sticky offsets.
- Dirty navigation cancel/discard, filter empty/reset, offline/reconnect, reduced
  motion and query loading/error/retry recover in both modes. All five first-run
  steps complete in the separate setup database; empty dashboards render in both
  modes. Browser-only mocked responses exercise import planning, Copilot suggestions,
  inherited variables and owner-only confirmations without external calls or saves.
- All 606 query/mutation/key source occurrences match the pre-correction commit
  (204 query options, 230 mutation options, 172 keys). This is a preservation
  guard, not proof from a count alone.
- Web typecheck/production build, strict workspace Biome, knip, 119 web tests and
  3,353 server tests pass (137 optional server tests skipped). Independent design
  and accessibility reviews closed their actionable findings. Browser coverage is
  not a full assistive-technology certification or a live deployment of each service.

One hydration warning occurred while an earlier test changed root font size before
hydration; it did not recur in 40 follow-up visits or the later route/reflow checks.
No application hydration suppression or speculative behavior patch was added.

## Live data preservation

The final production build is `.next-stock-ship`, served by the original all-role
custom server on localhost:3000. The existing runtime environment, config path,
database URL and encryption keys are retained. A private custom-format database
backup is validated with `pg_restore --list`; config files are backed up before
the graceful switch. Restart comparisons cover 72 tables/240 rows, all 62 persistent
config files and the original Desktop environment/type files. Post-start browser
verification uses an existing session and submits no settings or deployment changes.
The previous `.next-shadcn-release` build remains available for rollback. The public
website stays on localhost:3373. Exact rollout results are recorded in private
`launcher.json`, snapshots and the field-by-field settings comparison.

Final restart hashes matched every table, all 62 config files and original settings
files. After the read-only browser checks, all 72 table hashes and user settings
still match; the only config change is the periodic platform health report's
`checkedAt` timestamp. Its active alerts and cooldowns are unchanged. Existing-session
verification passes 12 route/control and two saved-application checks in both modes.
Health/readiness return 200, the public website returns 200 and test listeners are
stopped. No user's stored setting or data was changed by the UI work.
