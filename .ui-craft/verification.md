# Fieldwork frontend verification — 2026-10-21

Fieldwork replaces the rejected monochrome design across the panel, auth/public surfaces and marketing/docs. The build uses the existing shadcn/Radix/Recharts/Lucide stack with Geist and Geist Mono from Next's existing font support. No product dependency, schema, deploy-engine, tenancy or API change was introduced.

## Source coverage and design

[coverage.json](coverage.json) reconciles **344 visual sources:326 owned and18 vendor**, including55 page files. **72 visual sources change directly**; route/data wrappers and remaining consumers inherit the rebuilt shell, typography, surfaces, controls and settings composition. This is shared-system coverage, not a claim that every data wrapper needed a textual rewrite. Every source has a disposition. Vendor internals remain preserved;12 unused registry widgets are explicitly outside rendered scope.

The project inventory uses actual environments and service counts, divided rows and one routine project-opening affordance. Existing legacy `done` service states count as healthy, matching ServiceStatusBadge. The attention summary activates the existing project filter. Settings use divided sections and one resource heading; operational editors/tables retain their own frames. All existing destinations, service tab order/aliases, permissions, dirty guards and destructive confirmations remain authoritative.

[Research](research/README.md) records the official Anthropic frontend-design skill and Vercel Web Interface Guidelines applied alongside installed UI Craft. No skill was installed globally.

## Local gates

All four workspace TypeScript checks, strict Biome (**1,176 files**), pinned knip5.88.1 and both production builds pass. Backend tests: **3,353 passed /137 optional cases skipped** across234 passing files and14 skipped files. Web tests: **119 passed** across18 files. Package manifests, lockfile and server/CLI sources are unchanged. Generated next-env files were restored in the implementation worktree.

Latest logs under ignored `.nixploy-data/verification/fieldwork-rebuild/`: `typecheck-final-verified.log`, `biome-final-verified.log`, `knip-release.log`, `test-server.log`, `test-web-release.log`, `build-web-final-verified.log`, `build-landing-final-verified.log`. Remote CI is distinct and belongs to the exact pull-request head.

## Browser evidence

Playwright uses fresh extension-free Chromium/Brave contexts and disposable PostgreSQL17 fixtures. Panel processes use role `panel`, with Traefik boot disabled; fixture seeding never touched the primary database. Every matrix below tests both themes. Coarse-pointer evidence uses viewport screenshots and verifies the actual media query. Enlarged text means200% root font, not literal browser zoom.

| Receipt | Coverage |
|---|---|
| `release-route-report.json` + `landing-release-report.json` |710 route captures:268 panel,26 public/auth,416 marketing/docs. Zero page/hydration errors, document overflow or unnamed visible controls in the release matrices. Deliberate404s/redirect destinations are recorded. |
| `final-reflow-report.json` |348 cases:29 families ×320/390/768px ×100/200% text ×two themes. Zero overflow or page errors. |
| `overlay-release-report.json` |216 cases:36 dialogs ×desktop/390px/320px with enlarged text ×two themes. Zero overflow, page errors, unnamed fields, lost initial focus or body focus return. |
| `wizard-report.json` |18 template deployment-step captures; no deployment submitted. |
| `source-states-report.json` |28 saved source cases (six Git builders plus upload), plus4 authenticated Swagger captures. Fixture source/build fields restored. |
| `populated-controls-report.json` |20 populated alert/backup/volume/instance/schedule cases; disabled fixture records cleaned up; no jobs or Docker actions invoked. |
| `setup-report.json` + `access-report.json` |Actual fresh setup completes through all five steps, plus16 access-policy/viewer/no-organization cases. Fixture policies and memberships restored. |
| `error-report.json` |20 isolated renders of real web/landing error boundaries, including retry callback, System-theme synchronization and320px/200% text. This is component proof, not a claim that production crashed. |
| `functional-report.json` |Dirty-form cancel/discard, filtered empty/reset, offline/reconnect, reduced motion, query loading/error/retry in both themes. Response faults are browser-only. |
| `final-interaction-report.json` |6 final groups verify persistent service-search DOM/focus through loading/zero results, reset, attention action and compact account navigation/visible targets. |
| `branding-report.json` + `branding-long-report.json` |32 saved-branding cases across1440/768/390/320px: normal and80-character unbroken product names, custom accent/CSS, footer/support/docs links, both themes. Original fixture settings restored. |
| `swagger-3372-report.json` + `swagger-focus-3372-report.json` |18 collapsed/expanded/authorization captures and6 focused keyboard/scroll cases, including forward/reverse Tab containment, Escape and exact opener/scroll restoration. |
| `product-captures.json` + `capture-manifest.json` |Twelve actual fixture captures with content-addressed URLs; home labels the workspace as an example. |

The710-route sweep includes non-HTML documentation/text and a generated PNG. Dark-class checks do not apply to those responses. Public Swagger routes redirect to login; only authenticated Swagger cases prove the explorer.

Final follow-ups cover the last bounded changes after the broad matrices: a persistent service toolbar fixes first-keystroke focus loss during loading; environment controls stay together on phones; long branding wraps inside auth; the dark input token increases to `#737f8f`. Independent design checks include8 responsive and2 delayed-query cases. Accessibility verifies44px visible targets, sheet navigation/focus and input contrast **3.36:1 against the dark dialog /4.19:1 against its input fill**. No outstanding judged Critical/Major findings remain. Reviewer receipts: `review-design-closure.json`, `review-a11y-fieldwork-final.json`.

No real deployment, terminal command, provider setup, AI generation, migration apply, backup execution or restore was invoked for this visual rebuild. Their source contracts, permission gates and shared visual components are retained; route screenshots do not prove every conditional business branch.

## Finish bar and static detector

Hierarchy: project inventory and working form/editor dominate; navigation and evidence support them. Type: Geist UI/Geist Mono code, restrained400/500/600 weights and tabular operational numbers. Surfaces: distinct canvas/card/overlay in both themes; white light overlays intentionally use border/backdrop/shadow rather than a different fill. Spacing: fixed4px layout scale with rem text, wrapping and contained table/code overflow. Icons: existing Lucide plus factual brand marks. States: real loading/empty/error/partial/access/offline/dirty/success flows above. Motion: short state changes and global reduced-motion override. Copy: sentence case and concrete operations. Detail: separated control/card/dialog geometry, visible focus, tested touch targets and contrast. Data: scoped real counts, unknown metrics kept unknown, no fabricated costs/dependencies.

The deterministic scan covers326 owned visual sources and4 supporting modules, with a final changed-source pass. It reports143 contextual heuristics, not a clean scan:57 hover/focus matches are covered by shared global/primitive focus;37 data-state matches delegate to parents or mutation error helpers;25 mixed-unit matches are deliberate fixed geometry with scalable text/vendor CSS; three table matches have scroll owners; three modal matches are dropdown/nonmodal status surfaces; four outline matches have rings/active slots/focus containment; six destructive heuristics retain existing confirmations or accepted immediate metadata-only actions. Seven technical-prose em-dash and one uniform quota-grid matches are accepted minor style exceptions. `static-audit-combined.json` and `static-disposition.json` retain findings and reasons. Heuristic scores are not treated as proof of perfect design.

## Local integration and preservation

**localhost3000 serves the verified `codex/fieldwork-rebuild` branch**, using the original primary environment, encryption/auth keys, database and absolute configuration path. The original Desktop checkout and its dirty generated/status files remain byte-identical. No migration, reset or seed ran against primary data. Existing worker/crons/Traefik settings are retained; the new runtime uses the production build.

A PostgreSQL17 custom archive was created and its table list verified, and62 persistent configuration files were copied privately before switching. Comparing the snapshot taken after the old server stopped with the new server's snapshot proves **all72 tables /237 rows /3 projects /2 organizations /2 users and all62 configuration files unchanged**. Health and readiness return200, and four authenticated light/dark dashboard/profile captures show the existing session works with zero hydration errors.

During the preceding verification interval, one session organization selection and periodic health-monitor timestamps changed while the original server was still running; the final shutdown snapshot includes and preserves those latest states. They were not overwritten from an earlier backup.

Private integration receipts live in ignored `.nixploy-data/verification/fieldwork-local3000/`: archive, configuration copy, environment/file snapshots, `launcher.json`, `preservation-comparison.json`, readiness and browser reports. These contain secrets and must never be committed or uploaded wholesale. Marketing runs locally on3373. This receipt records a local rollout and review branch, not a remote production deployment or a GitHub merge.
