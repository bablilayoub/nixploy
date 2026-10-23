# Nixploy app design contract

## Current instruction
Rebuild the actual app using pure shadcn/ui, monochrome light/dark mode, and the restraint of Vercel. Replace existing compositions. This supersedes every earlier Fieldwork, Mobbin and custom-theme direction.

## Operator outcome
Find a project, understand service state, deploy or change configuration without learning decorative UI. Preserve every route, feature, role, confirmation, URL alias, keyboard action and unsaved draft. Preserve the primary database, encryption keys, config directory and settings.

## Composition
- Official sidebar-07 block: collapsible workspace navigation, organization switcher, contextual settings links and a compact breadcrumb header.
- Projects: searchable Item list and an adjacent activity Card; compact overview above it. No large repeated project cards.
- Service: identity and lifecycle actions, native line Tabs, horizontal configuration Tabs and standard Cards. No nested desktop task rail.
- Settings: contextual sidebar navigation, one content column, standard Cards and footer actions.
- Authentication: official login-03 Card composition; password recovery next to its field, retained SSO/passkeys/2FA/invitations/setup.
- Catalog, operations and infrastructure: native shadcn Table, Card, Input, Select, Dialog, Sheet and Empty compositions.

## Components and palette
New York registry components; existing Radix dependencies only. Neutral official palette. All rendered theme colors achromatic, including destructive and sidebar-primary semantics, which use the existing primary colors. Meaning uses labels/icons/confirmations. No custom skin, custom palette ramp, CSS filter or component-specific theme.
Existing user logos, avatars, tags, branding configuration and engine content remain user data. Do not erase them to manufacture monochrome screenshots.

## Acceptance
Verify every route family and important state in light/dark, mobile and desktop. Inspect actual screenshots for hierarchy. Test navigation, dialogs, retained drafts and permissions. Production build, typecheck, Biome and existing tests before primary restart. Backup and compare primary data/config before switching localhost:3000. Keep PR 34 draft.

## Learned constraints
Repeated shared-only revisions were rejected. A palette change and new shell do not constitute rebuilding page layouts. Do not claim completion from test counts. No accent colors, invented visual motifs, ornamental metrics or bespoke component skins.
