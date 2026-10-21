# Frontend rebuild verification — 2026-10-21

The panel, public/auth surfaces and marketing/docs site use one rebuilt monochrome system. This receipt covers presentation and interaction preservation. Existing API, tenancy, deployment and infrastructure behavior is retained. No dependencies were added.

## Source coverage

[`coverage.json`](coverage.json) reconciles every current visual TSX/CSS source: **343 sources, 325 owned and 18 vendored; 209 directly changed; 55 page files; zero unclassified entries**. Route wrappers and feature components that already express the correct data/behavior contract inherit rebuilt primitives, compositions and tokens. This is explicit shared-system coverage, not a claim that every source file needed a textual edit. Twelve inactive vendor widgets remain unused; mounted vendor integrations inherit the new site system. Vendor internals were preserved according to repository instructions.

The graph includes 450 TS/TSX/CSS sources. Its only visual sources outside a page import chain are the explicit error/404 boundaries, generated metadata image and 12 inactive vendor components. Each has a separate disposition. Redirect captures record their destinations. Conditional migration plan/apply results are source-inspected and inherit shared primitives; no live migration execution is claimed.

## Local gates

| Gate | Result | Local receipt |
| --- | --- | --- |
| All four workspace TypeScript checks | Pass | `typecheck-release.log` |
| Changed-file Biome autofix | Pass | `biome-release-changed.log` |
| Strict whole-workspace Biome | Pass, 1,175 files | `biome-workspace-release.log` |
| Pinned dead-code gate | Pass, knip5.88.1 | `knip-release.log` |
| Backend tests | 234 files / 3,353 tests passed; 14 files / 137 optional tests skipped | `test-workspace.log` |
| Web tests | 18 files / 119 tests passed | `test-web-release.log` |
| Web production build | Pass | `build-web-release.log` |
| Landing production build | Pass | `build-landing-release.log` |
| Whitespace / dependency review | Clean diff; package manifests and lockfile unchanged | Git diff |

Remote checks are reported on the pull request at its exact head. Local browser matrices below are separate from CI; CI does not execute this local screenshot harness.

## Browser and state proof

All receipts and full-size captures are under the ignored local directory `.nixploy-data/verification/monochrome-rebuild/`. That directory also contains private fixture credentials and must not be committed or uploaded wholesale. Playwright used headless Brave/Chromium with fresh extension-free contexts. Both themes were tested. Coarse-pointer captures use viewport screenshots and assert the media query; full-page emulation previously changed that query and was discarded as touch proof.

| Matrix | Verified scope and result |
| --- | --- |
| `final-route-report.json` | 710 captures: 268 authenticated panel, 26 public/auth and 416 marketing/docs. Zero page/hydration errors or document overflow. 702 responses 200; eight deliberate 404 cases. |
| `confirmation-report.json` | 18 focused production captures close the initial unnamed-control findings and verify root/redirect destinations. Zero errors, document overflow or unnamed visible controls. |
| `verified-reflow-report.json` | 348 cases: 29 surface families × 320/390/768px × 100/200% root text × two themes. Zero errors or document overflow. Twelve corrected profile cases replace the corresponding failing samples; the original report is retained. This proves doubled root text, not literal browser zoom. |
| `overlay-recheck-report.json` | Fresh 216-case sweep: 36 dialogs × desktop/390px/320px with doubled text × two themes. Zero errors, overflow, unnamed controls or lost focus return. Supersedes the earlier report with six narrow-dialog overflow findings. |
| `wizard-report.json` | All three template deployment steps, 18 cases across the same theme/viewport profiles. No deployment submitted. |
| `source-states-report.json` | 28 saved-source cases cover six Git builders and upload source at desktop and 320px/200% in both themes; fixture source/build fields restored. Four additional authenticated Swagger captures distinguish the actual explorer from login redirects. No builds/uploads/deployments submitted. |
| `populated-controls-report.json` | 20 production cases: disabled database/volume/instance backup, schedule and alert records. Every switch has its contextual name, keyboard focus and coarse 44px target. Temporary records removed; no toggle or execution actions invoked. |
| `swagger-3363-report.json` | 18 production collapsed/expanded operation/authorization cases. Zero errors or document overflow; dark descriptions use readable semantic text color. |
| `swagger-focus-3363-report.json` | Six production keyboard/scroll cases, including 320×640px/200%. Named modal/X, initial focus, forward/reverse Tab containment, Escape/X opener restoration, background inert/scroll lock, exact overflow/position restoration and reachable internally scrolled Close. |
| `setup-report.json` | Actual welcome/owner/organization/review/completion flow on a separately migrated database; both-theme step captures and empty dashboard. Completed without page errors. |
| `access-report.json` | 16 real 2FA-required, SSO-required, viewer and no-organization cases. Temporary role/policy/membership changes restored. |
| `error-report.json` | 20 browser renders of the actual five error-boundary components, with a reset callback spy. Both themes, desktop/320px enlarged text, stored/System/OS/storage preference checks. Isolated harness stubs the Next link boundary; no intentional production crash. |
| `functional-report.json` | Both themes: dirty edit cancel/discard guard, filtered empty/reset, offline/reconnect notice, reduced motion and enlarged-text profile. Browser-only delayed/faulted query responses exercise loading/error/retry; the real API recovers on retry. |
| `capture-manifest.json` | Twelve actual production UI images, six matching light/dark pairs, shipped with content-addressed filenames. Fixture numbers are labeled as an example workspace. Metadata image also verified at 1200×630px. |
| `landing-header-final-report.json` | 20 additional production captures after the CI cleanup: identical shared hero copy, GitHub brand icon, both themes at 1440/390/320px with 100/200% text, and mobile navigation forward/reverse Tab containment, Escape and exact opener return. Zero errors or overflow. |

The route matrix includes **50 non-HTML responses**: Markdown/text documentation and the generated metadata PNG. Its 25 dark-mode “theme mismatch” flags belong to these non-HTML responses, where an HTML dark class does not apply. The other 660 captures are HTML. Public `/swagger` captures are authentication redirects; only the authenticated matrices prove the explorer.

External provider setup, AI generation, terminal commands, live migrations/import application, backup execution, restore, Docker mutation and real deployment were not invoked for this presentation rebuild. Their controls, permission gates, source contracts and existing unit coverage are preserved; parent-route screenshots do not prove every conditional business branch.

## Finish bar by vertical slice

| Slice | Primary → supporting hierarchy | State/interaction evidence |
| --- | --- | --- |
| Workspace/project directory | Project/service directory → recent deployment evidence → summary metrics → navigation/help | Real populated/filtered/empty/error/loading states; mobile first service now y646 at 390×844; create/environment/source dialogs and focus return. |
| Service operations | Active editor/table/log content → service identity and permitted action → release/runtime evidence → explanatory text | All seven service kinds and upstream, stable URL tab aliases/order, named editors, dirty guard, logs focus return, recovery/configuration presentation, conditional saved-source variants. |
| Settings/infrastructure | Working form or table → section heading/navigation → role/permission explanation → supporting help | All settings route families, populated conditional switches, credential/provider/member dialogs, existing destructive confirmations and capability controls. |
| Auth/access/public | Form or overall service state → specific next action → context → branding/help | Real setup, invitation/login/recovery/2FA shells, authorization gates, no organization, populated status, maintenance 200, real 404/error boundaries and Swagger modal. |
| Marketing/docs | Product outcome headline → actual interface → specific capabilities and installation action → technical detail | All generated route instances, including 146 template, 23 documentation and three comparison entries; theme persistence/System synchronization, mobile navigation trap and metadata output. |

1. **Hierarchy:** working content dominates; operational evidence and navigation have lower visual weight. Marketing uses a product-led composition rather than equal feature cards.
2. **Type:** existing Inter and JetBrains Mono; compact supporting copy, tight display headings, tabular operational data. Forms and controls grow with text. Prose columns remain constrained; data tables/code intentionally allow internal horizontal scrolling.
3. **Surface stack:** semantic canvas/control/card/overlay roles in both modes. The deliberate white light-card/overlay fill exception is recorded in the brief; border, shadow and backdrop provide elevation. Native color-scheme follows theme.
4. **Spacing:** fixed 4px layout scale independent of root text size; distinct control, group and section rhythm. Operational tables deliberately compress. Header and dialog pixel gutters keep controls reachable when text doubles.
5. **Iconography:** existing Lucide family and real brand assets; status always includes text or a meaningful non-color signal.
6. **States:** idle/populated, delayed loading, empty/filtered, query error/retry, actual setup success, partial/unknown uptime, dirty/conflict discard and offline/reconnect all have explicit shared designs. Existing server preconditions/conflict errors remain authoritative; no concurrent-edit protocol was invented.
7. **Motion:** restrained hover/state transitions, no decorative idle particle/marquee effects in active marketing compositions. Global reduced-motion contract removes spatial movement and collapses timings; production functional checks pass.
8. **Copy:** sentence case, specific operation labels and preserved factual marketing/source attribution. Example fixture data is labeled. Conditional third-party text remains vendor-owned.
9. **Detail:** distinct control/card/dialog radii; layered neutral shadows, strong control edges, clear active tabs, visible focus and wrap/scroll behavior at enlarged text. Control boundaries measure 3.20:1 light and 3.17:1 dark against their fill.
10. **Data:** existing locale/time/byte/count formatting retained, aligned tabular numerals and readable identifiers. Unknown probes remain unknown; screenshots and charts do not introduce fabricated costs or success claims.

## Static detector disposition and independent review

`final-scores.json` covers all **320 owned TSX sources**, with zero scan errors. Raw heuristics report 118 anti-slop, 23 token and 12 static-accessibility findings. These are retained without changing rules or hiding source. They are not 153 confirmed product defects and are not presented as a zero-warning tool result.

| Raw finding | Context and disposition |
| --- | --- |
| 55 hover/focus and 37 empty/error heuristics | Shared global focus rules, rebuilt primitives and `QueryState` own those contracts. Runtime matrices and source ownership provide closure beyond isolated-file matching. |
| Five custom-modal heuristics | ProductShot is a static figure; ThemeProvider uses Radix DropdownMenu; site navigation uses Radix Dialog; ActivityTray and SaveBar are intentionally nonmodal/status surfaces. |
| Four removed-outline heuristics | Skip link uses a focus ring; CodeMirror uses the enclosing focus-within ring; OTP active slots show rings; Dialog contains focus and its actionable descendants show focus. |
| Six destructive-action heuristics | Database, instance operations and template-source removal retain DangerZone/ConfirmActionDialog/AlertDialog confirmation. Existing immediate tag/individual-rule/brand-asset removal is explicitly accepted as minor metadata behavior, documented in the brief. |
| Three table-overflow heuristics | Shared Table/scroll wrappers own horizontal overflow; parent reflow checks pass. The actual template environment-table issue found during review was fixed. |
| Seven prose em-dash and one uniform-grid heuristics | Existing technical prose and deliberately comparable quota fields; accepted minor stylistic exceptions. |
| 21 color literals / two tiny radii | Metadata/Satori output, branding input values/defaults, library selectors and checkbox/tooltip micro-geometry are explicit boundaries. Application surfaces use semantic tokens. |
| 11 reduced-motion / one image-alt heuristics | Motion is constrained globally and checked at runtime. The image match is a comment containing `<img>`; the actual branding preview has alt text. |

The fold classifier still calls the marketing composition a band because it sees three sibling sections. Actual rendered product dominance, evidence and cost-of-detail checks pass; this classifier mismatch is an accepted minor heuristic limitation. It is not relabeled as a passing classifier result.

Independent read-only design and accessibility reviews ran against source and real browser output. Findings that led to fixes included control-edge contrast, primary-tab distinction, mobile service visibility, maintenance routing, content-addressed product captures, enlarged-text overflow, missing labels, focus return, and the Swagger modal's semantics/trap/scroll behavior. The final judged bar requires zero outstanding Critical/Major findings; accepted minor exceptions are recorded above. Full local review receipts are `review-design-final.json`, `review-design-verified.json` and `review-a11y-closure.json`.

## Fixture and integration safety

The primary checkout, its dirty `next-env.d.ts`, original chat's dirty status note, existing application database/configuration and port3000 process were preserved. The new managed branch/worktree is `codex/monochrome-rebuild`. A task-labeled Postgres17 container uses loopback port59579 and a tmpfs database; panel previews run with role `panel` and Traefik boot disabled. No worker/crons/workloads were started. The separate setup preview is stopped.

Review previews: panel `http://localhost:3363`, marketing `http://localhost:3364`; development previews remain on3360/3361. Exact owned resource identities and ports are in ignored `fixture-ledger.json`. Cleanup must target only that ledger's resources. Private credentials remain local and untracked.
