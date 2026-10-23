# Restored design review — 2026-10-23

Verdict: a coherent, usable foundation with several concrete usability gaps. Keep the original visual direction and make targeted corrections. This review does not authorize another redesign.

## Checked

UI Craft and Critique: value, ease of use, Anti-Slop, Craft Test, hierarchy, clarity, signature and inspiration gap at the level-7 review bar. Live localhost:3000 surfaces: login, dashboard, project directory, application General, templates, monitoring and profile; localhost:3373 homepage. Captured all eight at 1280×800, 768×1024 and 375×812, in light/dark app themes or corresponding OS preferences for the fixed-dark website: 48 captures. Focused checks inspect slider accessible names, clipped setup text and fully loaded website feature images.

This is a sample across major page families, not an every-page or full accessibility certification. One existing Docker-image application was inspected. No deployment or configuration mutation was submitted; browser capture contexts block non-read requests. Some authenticated session UI can still be loading at capture time and is not reported as broken. No app code, design, saved settings or data changed.

## Passed

- Login has a clear submit action, persistent labels, recognizable password recovery and a separate passkey action. The form fits each sampled viewport.
- The app uses a consistent neutral surface/text system with functional service status colors and familiar controls. No competing decorative accent palettes were observed.
- Project/service pages maintain location context through breadcrumbs and tabs, with clear Add service or Deploy actions. Service forms use consistent section and save patterns.
- No document-level horizontal overflow or page JavaScript exception was detected across the 48 captures. Tables/tabs can intentionally scroll within their containers.
- The public homepage communicates self-hosting, includes a concrete install action and real product screenshots. Its feature screenshots load after scrolling; blank lazy images in initial full-page captures are not treated as a product defect.

## Findings

| Before | After | Why |
| --- | --- | --- |
| **P1 — resource controls lack accessible names.** All five sliders in the existing application expose only `slider` in Playwright’s accessibility snapshot. Visible labels are not associated with the controls. | Associate each resource label with its corresponding slider thumb using `aria-labelledby`. | UI Craft accessibility §1: every interactive control needs an accessible name. Screen-reader users cannot distinguish replicas, memory and CPU controls. |
| **P2 — desktop/tablet Projects buries the project directory.** With the setup checklist visible, All projects starts at y=1289 in the 1280×800 capture; the tablet layout puts it still farther down. Setup, four totals and analytics precede the core navigation task. | Move the project directory before analytics at all breakpoints. | Review hierarchy and path-length guidance: the primary task should be immediately findable. Mobile already uses the more useful ordering. |
| **P2 — setup instructions are truncated on phones.** At 375px, the domain task label has 244px of text in a 152px slot; both unfinished-step hints are also clipped. | Let the unfinished setup labels and hints wrap on mobile. | Responsive content should preserve the information needed to act. These are instructions, not redundant item names. |
| **P2 — mobile navigation targets are small.** The profile target is 32×32px; the menu uses the 36×36px icon variant and the theme toggle is visually scaled below 36px. | Give header controls 44×44px mobile hit areas while retaining compact desktop dimensions. | UI Craft responsive interaction guidance uses a 44px touch target. This is a usability recommendation, not a claim that every sub-44px control violates WCAG’s 24px minimum. |

## Source and rendered evidence

1. `apps/web/src/components/application/general-tab.tsx:21` renders `ResourcesForm`; its labels/sliders at `apps/web/src/components/application/resources-form.tsx:127` onward have no ID association. `apps/web/src/components/ui/slider.tsx:48` renders the unnamed Radix thumbs. Evidence: `focused.json` records five unlabelled accessibility snapshots; `service-dark-375.png` shows the corresponding visible labels.
2. `apps/web/src/app/(dashboard)/dashboard/page.tsx:10` renders `DashboardView`; `apps/web/src/components/projects/dashboard-view.tsx:79` orders setup and analytics before the directory from `sm` upward. Evidence: `captures.json` records the heading coordinates; `dashboard-light-1280.png` and `dashboard-light-768.png` show the full layout. Dismissing setup can reduce the distance but does not change the underlying ordering.
3. `DashboardView` renders `GettingStartedCard`; `apps/web/src/components/projects/getting-started-card.tsx:148` and `:155` explicitly truncate labels and hints. Evidence: `focused.json` records content and slot widths; `dashboard-dark-375.png` shows clipped unfinished tasks. The task buttons remain usable; this is a clarity issue.
4. `apps/web/src/components/layout/top-nav.tsx:129`, `apps/web/src/components/layout/profile-dropdown.tsx:65` and `apps/web/src/components/mode-toggle.tsx:20` render those controls. `apps/web/src/components/ui/button.tsx:26` defines the 36px icon size. Mobile captures confirm the compact header; the 32px avatar override is explicit in source.

Private screenshots and machine receipts: `.nixploy-data/verification/design-critique/`. They include account/configuration context and are not public website assets.

## Left alone

The original palette, typefaces, layout language and website’s fixed dark theme are intentional restoration choices. Equal template cards are appropriate peer items in a catalog; they are not the generic feature-card anti-pattern. The app does not need a new decorative signature to fix the findings above. Saved avatar colors and provider logos are user/content identity, not competing theme accents.

A six-file inline static scan was used as supporting evidence, not a design score. Its optional update-banner empty/error warning and login missing-error warning were rejected after reading the actual fallback/error handling. The password-recovery focus warning was not promoted without rendered focus proof. Minor transition/style preferences and numeric-slider precision suggestions were excluded from the priority list. No full contrast audit, screen-reader session, reduced-motion audit, Safari run or deploy-flow test was performed in this critique.

## Next step

First name the resource sliders, then bring projects ahead of analytics, then restore complete mobile setup instructions. A focused polish/accessibility pass can implement these while preserving the restored design. No implementation was made during this review.

## Implementation follow-up

The user authorized these fixes after the review. All four findings are addressed
without changing the original palette, fonts or component language. Slider thumbs
also retain identity across value changes: repeated arrow keys work without
losing focus. The project list moves in DOM order as well as visual order. On
phones, setup actions sit below complete instructions, and mobile header controls
have 44px hit areas without overlaps at 320px.

Validation: production build/typecheck, strict Biome, 119 web and 3,353 server
tests pass (137 optional server tests skipped). An isolated fixture run includes
32 screenshots and 57 checks across both themes and four widths. Deployment to
localhost:3000 retains the original database/configuration and encryption keys;
exact immediate snapshots match 72 tables, 241 rows and 62 persistent files.
Sixteen final read-only live checks pass. Post-check data/config comparisons
preserve all 241 rows and persistent files; only the automatic update-check
timestamp advances. Private follow-up receipts:
`.nixploy-data/verification/original-polish/`.
