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


## Landing and README follow-up — 2026-10-21

Keep the approved Fieldwork palette, Geist typography and restrained motion.
Marketing speaks to developers evaluating a self-hosted platform. Commit to the
stacked fold: concise left-aligned headline/action followed by the actual workspace.
The signature is a cropped product preview with accessible Projects/Deployments/
Monitoring tabs, using real fixture captures and a full-size escape. No live metric
claims or interactive imitation of the production panel. README uses the same
message and theme-aware screenshots; install and architecture documentation stay.


## Public website rebuild — 2026-10-23 (supersedes marketing direction above)

The user rejects the basic Fieldwork marketing site and explicitly authorizes a
modern technical rebuild of every public page, with good animation and freedom
over colors/components. Panel Fieldwork and all primary data/settings stay intact.
Rebuild scope: home, product, templates/catalog/detail, pricing, agents, docs/index/
articles, REST reference, comparisons/index/detail, about, privacy, errors and OG.
Preserve route/data/metadata contracts, documentation, sources and install actions.

Craft9 / motion6 / density5 / variance7. Public-site identity: graphite/porcelain,
signal orange, precise Geist display and mono code. Dark-first for new visitors;
retain stored Light/Dark/System. Fold composition: band. Signature: interactive
source→build→Swarm→Traefik schematic tied to Nixploy's real architecture,
clearly illustrative, with stage-specific explanations and documentation links.
Real panel screenshots remain evidence; no invented live metrics or customers.
Use existing Motion/Radix/Lucide only. Entrances and hover give hierarchy; drawing
and signal travel explain deployment. A persistent pause control and OS reduced
motion stop nonessential movement. No scroll hijacking or hidden no-JS content.
Each page family gets a direct composition pass, not just inherited token changes.


## Latest authority — monochrome library rebuild (2026-10-23)

The user rejects Signal as vibe-coded and requests a library-led monochrome
rebuild across the actual Next.js platform AND all website pages. This supersedes
both Signal orange and the prior Fieldwork-only app decision. Use official shadcn
(Radix) components and block composition; selected existing Magic UI assets serve
real screenshots. Neutral black/white/gray only for theme, status and charts;
factual brand/service icons may retain their colors. Saved settings, branding data,
Light/Dark/System, authentication, permissions and all routes remain intact.

App: conventional shadcn SidebarProvider/SidebarInset, organization switcher,
workspace navigation, command search and account menu. Resource tables lead;
forms and service tabs retain their real workflows. Website: product-led split
fold, real screenshots, quiet border geometry, compact type, no orange glow,
glass capsule, animated architectural ornament or oversized footer wordmark.
Craft9 / motion3 in app,4 on website / density6 app,4 website / variance4.
Signature: the actual project/environment inventory, shown consistently in product
and marketing. Functional behavior is carried by library primitives. No fake data.
Use the existing dependency set; vendor official components through the registry
CLI, mapping Radix imports to the installed umbrella package where necessary.

Research: official Anthropic frontend-design, Vercel Web Interface Guidelines and
shadcn skill. Their styling advice is subordinate to explicit monochrome choice,
repo tenancy/security constraints and existing component APIs. No global skills
installation or preset overwrite is needed. Full-site source/family inventory,
fixture browser tests, independent design/a11y review and preservation proof remain
required before finishing. Do not mistake reachability counts for good design.

## Latest authority — Mobbin reference (2026-10-23)

The user provides a full-page Mobbin screenshot and explicitly asks to copy its
visual system, with dark and light modes. This supersedes the split-hero,
border-heavy monochrome composition. Preserve Nixploy branding, routes, content
facts, conversion paths, library primitives and all primary data/settings.

Measured reference: centered80px/80 headline,652 weight,44px/48 section titles,
compact44px pill actions, white/#141414 neutrals, soft gray panels, generous
vertical spacing, image gallery, six image-led capability tiles, split agent
section, gray support band and centered closing CTA. Reuse existing Geist with
these proportions; proprietary Saans font files and Mobbin imagery are not assets
for this repository. Actual colored service marks remain allowed.

Website before→after: split hero+duplicated screenshot → centered inline-brand
hero+large tabbed product preview; bordered feature cards → screenshot gallery
and six soft image tiles; governance list → gray open-platform band; split install
close → centered CTA+copyable command; thin white footer → quiet dark sitemap.
Platform: the same white/graphite surfaces, pill controls and navigation,20px
panels,12px fields,24px dialogs and stronger headings; real resource/form density
and responsive sidebar behavior remain. Do not import marketing animation into
working forms. Craft9, variance4, density6 app/3 website, motion3 app/4 website.
Signature: genuine service marks inside the centered headline, then real product
screens shown as a gallery. The six equal tiles are an explicit reference choice.

## Actual app authority — focused workspace (2026-10-23)

The latest request is a complete rebuild of the actual Nixploy app with a clean,
straightforward interface, low overwhelm and every existing feature preserved.
The user confirmed “exclusively shadcn/ui components.” Use the existing shadcn/ui
primitives consistently for every control and disclosure; do not substitute
a ChatGPT visual identity. Keep the approved quiet monochrome layouts. Specialized
code editors, charts and terminals retain their existing engines within shadcn
surfaces so their capabilities are preserved. No new component-library dependency. The public Mobbin website is outside this composition pass.

App craft9 / motion2 / density5 / variance3. Sidebar is a quiet, tinted utility
rail; canvas is white / neutral charcoal. Page headings are compact, controls
rounded rather than capsule-heavy. Layout, dividers and typography do the work;
remove repeated card-on-card chrome. Signature: focused configuration workspaces
that show one related group at a time while retaining drafts across local section
switches. Deep links, service tab order and aliases, editor behavior, auth, role
checks, every query/mutation, destructive confirmations and background-operation
feedback remain. Settings/data/encryption keys and persistent config are untouched.

Feature families: projects/environments/tags/upstreams/GitOps/recovery; all seven
service kinds; source/build/resources; deployment history/preview/schedules; logs/
metrics/events/terminal/history; domains/env/backups/advanced/settings; Docker's
six tools; template catalog/filter/details/deploy; migration wizard; monitoring/
alerts/logs/Prometheus; schedules; account/security/API/MCP; organization/members/
teams/quotas/shared variables; server/SSH/certs; Git/registry/storage/template
integrations; branding/SSO/platform/AI/updates/users; activity/incidents; all auth,
setup, public status and failure states. Verify each family in both themes.
