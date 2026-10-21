# Fieldwork — production frontend rebuild

## Latest authority and learned constraints — 2026-10-21
The user selected Fieldwork at localhost:3370/fieldwork and explicitly authorized rebuilding the whole frontend, every page/component, while preserving all data/settings. The previous monochrome rebuild was rejected. The selected demo is a direction, still described as a little “vibecoded”: remove generic presentation, excessive decorative frames/eyebrows, tiny metadata ladders and marketing copy inside operational views. The prior concept-selection pause is superseded by this explicit selection. No further design approval is required to implement it.

## Product and audience
Nixploy is a self-hosted PaaS for developers/operators. Their first questions: which project, what is running, what needs action, and what happened during a release. Keep Nixploy identity, every route and feature, permissions, tenancy, deep links, tab aliases, dirty-form/confirmation behavior, saved branding, theme preference, cryptographic keys and backend contracts.

## Direction
Fieldwork's open horizontal shell, light neutral canvas, distinct white work surfaces, restrained graphite dark counterpart, project-first composition and generous alignment. Geist is a deliberate match to the approved demo; Geist Mono belongs in code/IDs/logs, not every small label. Product UI uses a compact 12/14/16/20/32px ladder; marketing has a separate 14/18/30/64px ladder. Small counts can use 11px; no 8–10px operational content. Craft9 / motion2 / density5 / variance5. One memorable project inventory; no arbitrary connector lines that suggest undeclared dependencies.

## Principles
The follow-up correction is binding: matching shared styling is insufficient. Review each page's actual content order, field grouping, action placement, feedback and fine interactions. Make direct page-level changes where the old structure remains weak, and record concrete before/after decisions. Route and screenshot counts prove reachability, not design quality.
1. Projects and their real environments/services lead; operational evidence supports. No invented requests, uptime, spending or service relationships. Counts retain project-scoping/capability filters.
2. Hierarchy through typography, space and alignment. Use cards for a contained object, table frames for tabular tools, unboxed divided sections for settings. Avoid a pile of identical cards.
3. Navigation uses existing routes, capability filters and one global command palette. Horizontal primary navigation, contextual secondary navigation, responsive mobile sheet. All existing destinations stay reachable.
4. Rebuild panel, auth/setup/recovery, every service kind/tab, logs/terminal/editors, settings/infrastructure/integrations, public uptime/errors/maintenance/Swagger, marketing/docs. Inventory every source and prove rendered coverage; assess each page’s composition and workflow directly. Shared primitives are the foundation, and do not by themselves prove a page was redesigned. Vendor source internals stay vendor code; their mounted appearance still participates.
5. Light/Dark/System and saved tenant/instance branding remain supported. Do not reset stored theme, org, cookies, credentials, services, config files or database rows. Test against a fresh disposable fixture, panel-only process, never seed the live database.
6. Controls have names, visible focus, adequate contrast and 44px touch targets; layouts reflow at320/390/768/1440px and text growth; reduced motion removes spatial effects. Skeleton/empty/error/partial/permissions states stay truthful and actionable.
7. Existing shadcn/Radix/Recharts/Lucide stack only. No new product dependency. Online skill research informs decisions, never overrides repository correctness, sentence case or selected Fieldwork aesthetics.

## Verification and integration
Fresh managed worktree from origin/main f1d316e; selected demo and live app remain intact while building. Preserve live data/settings with backup and before/after proof when integrating. All relevant typechecks/tests, strict Biome, production builds, real browser workflows, full route/source coverage and independent design/a11y review before completion. No scope waived because a screen is inconvenient to exercise.
