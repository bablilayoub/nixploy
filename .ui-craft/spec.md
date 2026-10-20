# Operator workspace — 2026-10-20

Scope: reskin plus approved shell/directory layout changes. Preserve all URLs, navigation destinations, service tab order, organization choice, capability filtering, keyboard interactions, unsaved-change guards and infrastructure confirmation flows. No dependency changes.

Craft 8 · motion 2 · density 7 · variance 5. Signature: status spine, a fine leading rule with a square endpoint that identifies the current context without moving content.

## Composition

- Desktop: subtly tinted grouped navigation, persistent organization context, a compact search/account bar, fluid working canvas. Below desktop, use the existing accessible navigation sheet.
- Projects: compact status summary, project directory as the dominant task region, deployment history/trends below. Empty, filtered, loading and failed states retain their existing actions.
- Project: project identity, URL-synced sections, environment/action rail, service search and tables. Preserve environment switching and unsaved-change confirmation.
- Service: shared breadcrumb, wrapping identity, explicit state and primary action; tabs retain their routes/order. Configuration sections use an 18px hierarchy; operational viewers keep their own working frame.
- Editors/viewers: shared palette and font authority, legible comments, distinct inset/toolbars, explicit loading/connection/error states.

## Shared component contract

Existing primitive props and variant names remain valid. Feature work uses Button, Input, Select, Badge, Tabs, TableCard, SettingsSection and PageHeader rather than restyling controls locally. Color utilities include `bg-shell`, `text-shell-foreground`, `bg-panel-inset`, `border-control`, `bg-selection`; the `status-spine` utility is reserved for the active context. Primary action and selection colors always derive from overridable `primary`/`brand` tokens.

Use 4/8/12px radii by role, 4px spacing increments, 40–48px desktop rows and 44px touch targets. Typography: IBM Plex Sans, IBM Plex Mono for operational values/identifiers; page 28/32, section 18/24, body 14/20, supporting 12/16, code 13/20.

## Verification

- Baseline and final real-app screenshots at desktop/mobile in light/dark; organization custom accent included.
- Keyboard navigation, menus/dialogs, long names, empty and partial/error states, scroll overflow and 200% zoom.
- No hydration/console errors; semantic text/focus contrast; reduced-motion behavior.
- Web typecheck and strict changed-file Biome; final production build/full gates coordinated by root.
