# Mobbin-reference platform and website — 2026-10-23

Current authority: the user's supplied full-page Mobbin reference and explicit
light/dark requirement. This supersedes the previous monochrome split-hero skin,
while preserving its library components and real product workflows.

[Research and source mapping](research/mobbin-reference.md) records measured
reference proportions, composition, component reuse and what remains Nixploy.
Both apps share white/graphite canvases, soft20px panels,12px fields,24px overlays,
pill actions/navigation and stronger headings. Website home now has a centered
three-line brand-mark headline, large tabbed product preview, screenshot gallery,
six image tiles, split MCP section, gray open-platform band and centered close.
Shared headers/search/catalog/docs/pricing/reference/recovery surfaces follow the
same system. Real operational content remains appropriately denser in the app.

## Verification

Private receipts: ignored `.nixploy-data/verification/mobbin-system/`.

-504 responsive cases:42 families ×320/390/768px ×100/200% root text ×two modes;
  no document overflow, page/hydration errors or coarse-pointer drift. Root-font
  enlargement is distinct from browser-toolbar zoom.
-12 additional dashboard cases close adaptive metric columns and text wrapping.
  Independently:320px/200%=one288px column;390px/100%=two173px columns.
- Independent design:36 representative route/theme/viewport checks. Reference
  composition is recognizable; images load after scrolling. A slider regression
  caused by equal card/track colors was fixed with `bg-input`:3.167:1 light and
  3.355:1 dark. No judged blockers remain within that review's scope.
- Independent accessibility:48 layout cases,14 contrast/hover samples, anonymous
  auth, keyboard dialogs/sidebar/service tabs, touch targets, theme persistence,
  reduced motion and gallery pause/duplicate focus behavior. Findings are closed;
  the report documents bounded coverage rather than an exhaustive speech audit.
- Shared skeletons use foreground tint so loading shapes remain visible on soft
  cards. Dialog focus has an explicit visible replacement outline. Image crops
  declare both axes. Gallery pauses on hover, keyboard focus and saved pause;
  OS reduced motion stops nonessential motion.
- Backend tests:3,353 passed/137 optional skipped. Web tests:119 passed.

Both production builds, all four workspace typechecks, strict Biome (1,194
files) and knip pass. Generated Next environment/TypeScript changes were restored
in the implementation checkout. A production sweep passes710 route/theme checks:
268 panel,26 authentication/public and416 website, including Markdown/PNG and
intentional redirects/404s. No page/hydration errors, document overflow or unnamed
visible controls were recorded. Theme-class exceptions are non-HTML responses.

Sixteen settled home/features/API/templates captures at1440/390px in both modes
verify actual imagery and final composition. The capture harness primes offscreen
marquee copies before checking image completion; ordinary lazy loading was checked
separately by the independent reviewer. Twelve final control checks cover the
production sidebar, existing primary authentication and website labels. Twelve
fresh production fixture product captures have content-addressed URLs in the
website and README. Dirty cancel/discard, empty/reset, offline/reconnect, reduced
motion and browser-only query loading/error/retry pass in both themes.

Route coverage is separate from complete branch/workflow coverage; the existing
source contracts and prior workflow matrices still apply. The source inventory
contains365 visual files (344 owned,21 vendored),153 changed cumulatively against
the original baseline, and zero unclassified. That is shared-system coverage, not
a claim that365 files needed a textual rewrite in this pass.

## Detector and finish bar

An inline before/after scan is used because the detector's configured workspace
root does not include this attached worktree. The bounded scan (26 baseline/28 current owned visual sources) decreases from14
contextual heuristics to13. Remaining findings are accepted fixed-geometry/rem
combinations and2px global focus rounding. They are not a clean numerical score.
The new missing-height and dialog-outline matches were corrected. Source-to-line
mapping and scan coverage remain in static-before.json/static-after.json.

Hierarchy follows the reference: a single centered message, real product evidence,
then individual capabilities and actions. Geist/Geist Mono retain a consistent
weight/size rhythm. Surface levels are deliberate in both modes, with dark footer
tokens scoped locally. Operational tables remain legible, statuses retain text
and shape, active controls remain visible, and the altered non-happy states were
checked. Copy keeps factual product content and sentence case; no invented trust
metrics, logos-as-customers or testimonial quotes are introduced.

## Known CI baseline outside this visual pass

CI on baseline60eefb9 already fails `pnpm audit` and both Docker/Trivy architecture
jobs on the pinned Next.js16.3.8. Official advisories GHSA-2464-fhr4-w9xw,
GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r identify16.4.1+ as fixed. This requires
an explicit framework version update beyond the repository's existing16.3 minor
pin; it is not repaired by a visual redesign. No advisory is suppressed and no
security gate is weakened. The PR remains a draft; local UI gates are reported
separately from remote security CI.


## Local rollout and preservation

localhost3000 serves the production `.next-mobbin` panel with the original
database, environment, auth/encryption keys, config directory and all-role worker/
cron behavior. Website production serves3373. Existing `.next`/`.next-mono` panel
builds and private backups remain available. No primary migration, reset, fixture
seed, deployment or restore was run. The original Desktop checkout was not edited.

A PostgreSQL17 custom archive was made after graceful shutdown and its488-line
contents list verified;62 persistent configuration files were copied privately.
There were no active deploy jobs before shutdown. Every table hash matched across
the restart:72 tables,240 rows,3 projects,2 organizations and2 users. All62 files
and original settings/env/generated-file hashes also match. Readiness returns200;
four existing-session dashboard/profile captures pass light/dark with the new
neutral geometry, one main landmark and no hydration/width error.

A later comparison after browser verification finds only the expected update
checker's `webServer.updateLastCheckedAt` timestamp advanced inside metrics_config.
All other data/settings and persistent files are unchanged. That new timestamp
was retained rather than overwritten from an earlier backup. Private proof is in
preservation-comparison.json, preservation-verified.json, release-controls.json
and launcher.json. PR34 stays a draft; this is local rollout, not remote deploy.
