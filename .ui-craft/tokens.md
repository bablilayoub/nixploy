# Operator workspace token contract

`apps/web/src/app/globals.css` is the color authority. Existing Radix/shadcn primitive APIs remain the interaction layer; their presentation is owned by Nixploy. Do not introduce another component system or a parallel palette. CodeMirror uses these CSS variables; xterm resolves the same variables to concrete colors at runtime.

| Role | Current choice |
| --- | --- |
| Canvas / content / overlays | `background`, `card`, `popover`; cool mineral light, plum-ink dark; white working surfaces in light mode |
| Shell / inset | `shell`, `shell-foreground`, `panel-inset`; subtle navigation tint and recessed content, never full black |
| Text | `foreground`, `muted-foreground`; placeholders and descriptions remain readable in both themes |
| Action / brand | Plum `primary` and `brand` by default; saved instance/organization colors override both. Derived selection tints follow `brand`, never a second fixed accent |
| Status | `success`, `warning`, `destructive`, `info`, only when communicating actual state |
| Typography | IBM Plex Sans body/headings; IBM Plex Mono for code, identifiers and numeric readings; tabular numbers for counts |
| Type scale | 12/16px supporting labels, 14/20px body/forms, 18/24px section titles, 28/32px page titles, 13/20px code |
| Spacing | Tailwind 4px grid: 8px controls, 12px rows, 16px groups, 24px sections |
| Radius | 4px controls (`rounded-md`), 8px working panels (`rounded-lg`), 12px overlays (`rounded-xl`); status endpoints remain square |
| Elevation | Hairline borders for data surfaces; existing popover/dialog shadows for overlays |
| Motion | 140ms color/border/opacity feedback; no layout shifts, entrance choreography or idle decoration. Reduced motion retained |
| Layers | Existing sticky navigation, Radix overlays and activity/toast stack; avoid new arbitrary z-indices |

Page headers wrap meaningful long names, align a concise description and primary action, and share responsive spacing. Filters and secondary controls sit below the page heading. Loading skeletons follow final geometry; partial-query failures remain visible with retry.

## Three layers

1. Palette: cool mineral neutrals and a plum/rose action pair, with independent semantic state colors.
2. Semantic: `background`, `card`, `panel-inset`, `shell`, `foreground`, `muted-foreground`, `border`, `control`, `primary`, `brand`, `selection`, `code-*`.
3. Components: existing Button/Input/Select/Tabs/Table/Card/SettingsSection/PageHeader interfaces; `status-spine` is the shared active-context treatment. A component may choose layout, never invent a new hue or font.

Input boundaries and focus use stronger tokens than decorative panel dividers. Text/code colors meet 4.5:1; focus and control boundaries meet 3:1 against adjacent surfaces. Mobile actions preserve 44px hit areas; dense desktop controls may be smaller.
