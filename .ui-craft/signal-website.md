# Signal public website — historical checkpoint

Superseded by [Monochrome library rebuild](monochrome-library.md). The notes below
describe the earlier rejected direction and its verification, not the current UI.

The user rejected the basic marketing treatment and requested a modern technical
website with animation across every public page. Signal supersedes the marketing
part of Fieldwork; the authenticated panel retains Fieldwork. This pass changes
landing presentation and client interactions, with no backend, schema, dependency,
authentication, deploy-engine or primary configuration changes.

## Composition and coverage

| Family | Direct work |
|---|---|
| Home | Display-scale fold, interactive source/build/Swarm/Traefik band, real product preview, sourced platform facts, featured applications and asymmetric install close. |
| Features | Architecture introduction, section navigation, screenshot-led capabilities and image-free sections that use the full reading width. |
| Templates | Category rail, search/filter/reset and empty state; real catalog data. Detail pages separate facts, install steps and service specification, with brand-image fallbacks. |
| Pricing | Software/infrastructure distinction, free plan, optional human support and included capabilities. |
| Agents | Keyboard-accessible deploy/diagnose/rollback example tabs, actual tool names and explicit illustrative labels. |
| Docs | Reading canvas, navigation and section rail, quick-start paths, copyable install command, article/code/callout hierarchy. Global searchable guide index. |
| API | Searchable generated endpoint catalog, method filter, counts, empty/reset, router anchors and keyboard-scrollable endpoint tables. |
| Comparisons | Index rows, readable source disclosure, divided facts and choice sections. Existing sourced claims and review dates retained. |
| About / privacy | Architecture-led About; policy reading column. About no longer frames Nixploy as derived from other panels. |
| Recovery / metadata | Branded 404 and error boundaries, retry callbacks, dark-first bootstrap and matching social image/headline. README keeps real panel captures and aligns the product message. |

Graphite and porcelain canvases, one orange accent, Geist/Geist Mono, distinct
surface levels and a consistent gutter replace the earlier marketing palette.
New visitors start dark; existing Light/Dark/System choices remain authoritative.
No fabricated live activity, customer metrics or illustrative product screenshots.

The source inventory now contains355 visual sources (337 owned /18 vendor), with
no unclassified entries. Its131 directly changed sources are cumulative against
the original frontend baseline `f1d316e`, **not**131 files changed in this website
pass. The panel is unchanged against merged main `2061fe7`. Registry primitives
retain their source; shared tokens, composition and control rules style consumers.

## Motion contract

Motion6: short hero entrances, one reveal per section, route opacity, connector
travel and restrained hover. Stage selection changes real explanatory content
and its documentation link. `nixploy-site-motion` persists the pause choice;
paused connectors stop and figures stop transforming. OS reduced motion disables
nonessential travel. Server-rendered content remains readable without JavaScript.
No scroll hijacking, cursor effects or new animation dependencies.

## Verification

Private receipts: `.nixploy-data/verification/signal-website/` (ignored).

| Receipt | What it proves |
|---|---|
| `routes-final-report.json` |208 public URLs ×two themes =416 checks:366 HTML captures,48 Markdown responses and2 PNG responses. Deliberate404 recorded. No page/hydration errors or document overflow. Four unnamed-input flags were validator false positives for wrapping labels; native accessible names are verified by the final interaction/capture receipts. |
| `reflow-report.json` |192 cases:16 page families ×320/390/768px ×100/200% root text ×two themes. Zero overflow/page errors after the initial pricing/docs/home findings were fixed. This is enlarged root text, not browser zoom. |
| `interactions-final-report.json` |22 final groups: stage selection/guide, docs search/empty/shortcut/focus, real preview/keyboard tabs, persistent pause/figure stability, clipboard success/failure, catalog and endpoint filters/reset, agent tabs, mobile focus containment/return, saved themes, OS reduced motion, four no-JS reading paths. |
| `captures-final-report.json` |Settled full-page samples across eight families in both themes, loaded screenshot evidence, native input labels, and final search focus/44px target at1440/320px in both themes. |
| `error-report.json` |Eight isolated renders of the actual landing/global boundaries: light/dark,1440px and320px/200% text, reset callback and System-theme synchronization. No production crash was induced. |
| Independent reviews |Design found broken comparison disclosure, prohibited About framing and unused feature columns; focused closure verifies all three fixed. Accessibility found ineffective pause; closure verifies connector pause. Follow-up checks close dialog target/figure stability and the final search focus ring. No remaining judged Critical/Major findings. |

Workspace TypeScript, strict Biome (1,187 files), knip5.88.1 and the landing
production build pass. Server tests:3,353 passed /137 optional skipped, using the
existing disposable fixture environment; web tests:119 passed. No test seeds or
migrations ran against primary data. The unchanged panel remains healthy on3000;
the production marketing preview runs on3373. Remote CI belongs to the exact PR
head and is distinct from these local results.

## Finish bar and detector disposition

Hierarchy: one dominant message or task per family; reading pages use content
columns and navigation instead of repeating the homepage. Type: display drama
for marketing, quiet article text, mono code and technical labels. Surfaces:
three levels in each theme with readable focus and controls. Spacing: scalable
text with wrapping and contained code/table overflow. Icons: existing Lucide and
factual application marks. States: tested search/filter empty/reset, copy failure,
image fallback, recovery and no-JS content. Motion: pause/reduced behavior above.
Copy: concrete platform operations and illustrative labels. Detail:44px primary
touch controls, responsive menu/search and saved preferences. Data: real catalog,
generated endpoints and actual panel captures.

The deterministic scan covers48 owned TSX/CSS sources. It is **not a clean scan**:
20 contextual findings remain after fixing the search input's real missing focus
ring. Hover matches use the shared `:focus-visible` floor or focusable parent;
the dropdown warning is Radix DropdownMenu, not a custom untrapped modal; the
API table scroll owner is its enclosing keyboard-focusable section. Mixed units
pair fixed geometry with scalable type. Two em-dash flags are retained technical
explanations. These are reviewed dispositions, not proof of perfect design.
The rendered fold detector matches the intended band; screenshots and independent
judgment remain primary evidence. No numerical aesthetic score is claimed.
