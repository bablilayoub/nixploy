# Monochrome platform and website — 2026-10-23

This is the current design authority. It supersedes the earlier Signal website
and Fieldwork shell while retaining the real product workflows and user settings.
The user's explicit request covers the actual Next.js platform and every public
website family, with a monochrome theme and library components.

## Research and implementation

[Official sources and adapters](research/monochrome-libraries.md) records the
Anthropic frontend-design skill, Vercel Web Interface Guidelines, official shadcn
skill/blocks and Magic UI primitives. Skills were read, not installed globally.
Registry components were installed through the shadcn CLI using adapted registry
items that reuse the installed Radix umbrella and local aliases. No dependency
manifest or lockfile change, schema migration or backend API change is needed.

| Surface | Current composition |
| --- | --- |
| Platform shell | shadcn SidebarProvider/SidebarInset, real permission-filtered navigation, organization switcher, command search, theme/account menus and existing activity/deployment feedback. Below1024px navigation uses the library Sheet. Collapsed desktop content is inert. |
| Project overview | Four real overview Cards, searchable/filterable Table, environment links, service counts and labeled health. Mobile uses two compact metric columns and in-row health/environment summaries. Loading uses matching table/metric skeletons. |
| Settings | Shared shadcn Card header/content/footer composition, compact category navigation and retained forms/actions, dirty-state guards and permissions. Existing editors and tables keep their own framing through the bare variant. |
| Service pages | Shared Breadcrumb and page header, one canonical URL-synced tab order, neutral status shapes plus text, official Empty composition, retained deploy/runtime/domain/environment/backup/advanced/settings workflows. |
| Authentication | Conventional centered Card/Form with saved branding, recovery links, docs/support and theme controls. Input/logo/recovery targets meet the44px project floor. |
| Website | Product-led split hero, one Magic UI Safari frame containing an actual workspace capture, short BlurFade entrance, shadcn navigation/Buttons/Tabs/Input/Accordion and Magic UI BentoGrid with actual screenshot evidence. No glow, glass capsule, animated architecture ornament or giant footer wordmark. |
| Public families | Features, templates/detail, pricing, agents, docs/articles, API, comparisons/detail, about, privacy and recovery share the new typography, surfaces and controls. Existing generated/source/SEO/content contracts remain. |
| Documentation assets | Twelve fresh production fixture captures, content-addressed URLs and matching README message/images. Example workspaces are labeled; captures contain no primary user data. |

Both apps use the same black/white/gray semantic roles in light/dark themes,
including status and charts. Text and shape distinguish status rather than hue
alone. Authentic service/brand icons and stored user branding remain authoritative.
Saved Light/Dark/System choices and the website pause preference persist.

## Source coverage

[coverage.json](coverage.json) contains363 visual sources:342 owned and21 vendored,
with zero unclassified. Its146 directly changed sources are cumulative against
original frontend baseline `f1d316e`, not146 new textual rewrites in this pass.
Pages retaining their data wrappers inherit the shared composition/theme/control
contracts. Three new landing registry primitives remain vendored; web primitives
follow the repository's existing owned-component lint policy.

## Verification

Private receipts live under ignored `.nixploy-data/verification/mono-library/`.
They contain fixture/preservation material and must not be uploaded wholesale.

- Workspace types pass across all four packages. Strict Biome passes1,192 files;
  knip passes after excluding generated alternative Next build directories.
- Both production builds pass. The web `NIXPLOY_NEXT_DIST_DIR` override leaves
  the existing primary `.next` build available while `.next-mono` is verified.
- Server tests:3,353 passed /137 optional skipped. Web tests:119 passed.
- Responsive discovery:504 cases across42 route families,320/390/768px,100/200%
  root text and both themes. It found14 cases with document overflow. The fixes
  change the sidebar breakpoint, wrap workflow tabs and the automation summary,
  and retain useful mobile table summaries. All252 affected-setting closure cases
  pass, with no document overflow, page/hydration errors or coarse-pointer drift.
  Enlarged root text is not literal browser-toolbar zoom.
- Functional checks in both themes retain unsaved-form cancel/discard, filtered
  empty/reset, offline/reconnect, reduced motion and query loading/error/retry.
  Query faults are browser-only; real API data recovers on retry. No settings save
  or infrastructure operation was submitted.
- Independent design review closes mobile metric height, health visibility and
  stale screenshots. Projects appears around y488 at390px; all12 capture URLs
  return200 and match hashes. No overflow at390/768/1023/1024px.
- Independent accessibility review closes collapsed-sidebar invisible focus,
  trigger disclosure state and undersized auth/environment/logo targets. It tests
  Sheet/search focus containment and return, keyboard tabs, catalogs/API filters,
  theme/pause persistence and OS reduced motion. Shared neutral text pairs pass
  WCAG contrast; dark supporting text remains an explicit APCA advisory for small
  regular copy. No speech-session or exhaustive pixel/alpha audit is claimed.

The production route sweep passes710 checks:268 panel,26 authentication/public
and416 website URLs across both themes, including Markdown/PNG responses and
intentional redirects/404s. No page/hydration errors, document overflow or unnamed
visible controls are recorded. Dark-class checks do not apply to Markdown/PNG.
After final label/Breadcrumb/cookie/lint adapters, both production builds pass
again;12 bounded production control checks confirm the new build’s sidebar,
primary auth/dashboard/profile and website labels. Sixteen settled website
captures cover home/features/API/templates at1440/390px in both themes, scroll
through lazy imagery and verify every visible image loads.

Route reachability and screenshots do not establish every conditional deployment/
provider/database workflow; their retained contracts and prior workflow matrices
remain separately documented in refinement.md.

## Finish bar and detector disposition

Hierarchy: the resource inventory or active form is primary; headings and actions
support it; navigation and supporting counts are quieter. Website copy leads into
actual product evidence. Typography: Geist/Geist Mono, restrained weights and
operational tabular numbers. Surfaces: neutral canvas/Card/overlay with borders,
backdrop and shadow distinguishing white light overlays. Spacing:4px layout scale,
rem text, tighter related controls and distinct section gaps. Iconography: Lucide
UI with authentic product marks. State, motion and copy: real query skeletons,
actionable empty/error/retry/offline/dirty states, short transitions, reduced-motion
support and sentence-case concrete operations. Data remains tenant-scoped and
comes from existing queries; unknown metrics remain unknown.

The detector cannot access this attached worktree by path because its configured
root is another checkout. An inline scan therefore covers38 changed owned visual
sources (165,571 UTF-8 source bytes), with a file/line mapping in static-audit.json.
It flags16 contextual heuristics rather than a clean score: the skip link has a
replacement focus ring;2px global focus rounding is intentional; twelve mixed-unit
matches combine fixed layout geometry and scalable text; tag removal retains its
existing metadata-only behavior, and branding-image removal edits the form draft
before Save. These are explicit reviewed exceptions, not evidence of absent focus
or unconfirmed infrastructure deletion. Browser and independent review evidence
remain the design/accessibility proof. No perfect numerical score is claimed.


## Local rollout and preservation

The verified production platform serves localhost3000 from `.next-mono` using
the original primary environment, database, encryption/auth keys, absolute config
path, process role, workers/crons and Traefik boot preference. Website production
preview serves localhost3373. The previous `.next` build remains available for
rollback. No primary migration, reset, fixture seed, deployment or restore ran.

Before switching, a PostgreSQL17 custom archive was created and its488-line table
list verified;62 persistent configuration files were copied privately. There were
no queued/running deployments when the previous process stopped gracefully. The
stopped-before and immediate-after snapshots match every table hash:72 tables,
240 rows,3 projects,2 organizations,2 users,62 files, and original environment/
generated-file settings hashes. Health and readiness return200.

Four primary authenticated dashboard/profile captures in light/dark confirm the
existing session works, the new sidebar/neutral palette render, one main landmark
remains, and no hydration error or document overflow occurs. A later read-only
comparison after browser checks finds only normal runtime changes: rolling auth
expiry/updated timestamps and the update checker’s last-checked timestamp. All
other data, settings and persistent files remain unchanged. These were retained,
not overwritten from the backup. The original Desktop checkout was not edited.

Private proof: preservation-comparison.json, preservation-verified.json,
preservation-runtime-differences.json, preservation-runtime-config-fields.json,
release-controls.json and launcher.json. These are local rollout receipts, not a
remote production deployment or PR merge. PR34 remains a draft for review.
