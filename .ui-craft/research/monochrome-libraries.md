# Monochrome library research — 2026-10-23

The user explicitly requested online research and library components for both the
actual platform and the entire public website. Their monochrome preference
supersedes the previous orange website and horizontal Fieldwork app direction.

## Skills applied

- [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design): product-specific content, deliberate typography/composition and avoiding decorative SaaS filler. The actual workspace is the marketing evidence.
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md): named controls, keyboard operation, focus, reduced motion, readable layouts, truthful async states and retained user input.
- [Official shadcn skill](https://ui.shadcn.com/docs/skills), [source](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md): inspect installed primitives, use component variants, compose Cards/Tables/Sidebar/Form rather than rebuilding controls. The repo's existing Radix base and fixed dependency set remain authoritative.
- Installed UI Craft: discovery, explicit brief/tokens, source/family coverage, browser verification and separate read-only design/accessibility reviewers. A geometric change has to make the real operator task clearer.

The skills.sh leaderboard was checked, then the official source was read. No
unknown third-party skill was executed or installed globally. Full fetched source
and CLI output are retained in ignored `.nixploy-data/verification/mono-library/`.

## Components used

| Source | Application |
|---|---|
| [shadcn sidebar-07](https://ui.shadcn.com/blocks/sidebar), [Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) | Platform SidebarProvider/SidebarInset, grouped navigation, organization switcher, mobile Sheet and desktop collapse. Real permissions/routes replace sample data. |
| [shadcn dashboard](https://ui.shadcn.com/blocks/dashboard), [Card](https://ui.shadcn.com/docs/components/radix/card), [Table](https://ui.shadcn.com/docs/components/radix/table) | Real overview counts, project/environment inventory and settings composition; no demo rows, invented metrics or new data endpoint. |
| [shadcn Empty](https://ui.shadcn.com/docs/components/radix/empty), [Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb) | Shared actionable empty states and resource context. |
| [shadcn Navigation Menu](https://ui.shadcn.com/docs/components/radix/navigation-menu), [Tabs](https://ui.shadcn.com/docs/components/radix/tabs), [Input](https://ui.shadcn.com/docs/components/radix/input) | Website navigation, product/workflow/agent tabs, docs search and catalog/API search. Existing Radix dialogs, shadcn Accordion/Button and native generated reference semantics stay in use. |
| [Magic UI Safari](https://magicui.design/docs/components/safari), [Blur Fade](https://magicui.design/docs/components/blur-fade), [Bento Grid](https://magicui.design/docs/components/bento-grid) | Real screenshot frame, short entrance, asymmetric Card composition with real product imagery. Existing vendored source reused. No glowing borders, beams, cursor effects or invented product UI. |

New primitives were installed through `pnpm dlx shadcn@latest add` using registry
items. The registry files were adapted to import the already-installed `radix-ui`
umbrella and local aliases; dependency and existing-file overwrite steps were
excluded. Existing component variants, auth/forms and business contracts remain.
The legacy Sidebar source's CSS variable shorthand was mapped to Tailwind v4's
`var()` form. Collapsed desktop offcanvas content is inert, its trigger exposes
expanded state, and mobile width/targets fit the viewport. These are compatibility
and accessibility adapters to library source, not a replacement control system.
The shared Empty description uses a div because descriptions can contain links.
The current BreadcrumbPage is a noninteractive span with aria-current; native
labels explicitly target registry Input IDs. Stable React state setters are omitted
from effect dependencies, and the official cross-browser preference cookie is
retained with a scoped lint explanation.

The existing Safari source has fixed SVG mask IDs. The hero mounts one dark
capture frame in both themes, avoiding duplicate hidden SVG instances. The
separate product explorer still offers theme-matched captures and full-size links.
No library runtime dependency, schema, tenancy or API contract is added.
