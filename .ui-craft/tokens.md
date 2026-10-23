# Existing token contract

Use `apps/web/src/app/globals.css` and the shadcn component variants as the authority. Extend their semantic tokens when needed; do not introduce a competing theme.

| Role | Current choice |
| --- | --- |
| Canvas / content / overlays | `background`, `card`, `popover`; light warm neutral and dark zinc layers |
| Text | `foreground`, `muted-foreground`; placeholders and descriptions remain readable in both themes |
| Action / brand | `primary` is monochrome; `brand` preserves the saved organization accent |
| Status | `success`, `warning`, `destructive`, `info`, only when communicating actual state |
| Typography | Inter body/headings; JetBrains Mono for code; tabular numbers for counts |
| Type scale | 12px supporting labels, 14px body/forms, 16px section titles, 24px page titles with tight tracking |
| Spacing | Tailwind 4px grid: 8px controls, 12px rows, 16px groups, 24px sections |
| Radius | Existing radius scale; compact controls `rounded-md`, grouped surfaces `rounded-lg`, dialogs existing primitive |
| Elevation | Hairline borders for data surfaces; existing popover/dialog shadows for overlays |
| Motion | Existing short color/focus transitions; reduced motion retained |
| Layers | Existing sticky navigation, Radix overlays and activity/toast stack; avoid new arbitrary z-indices |

Page headers wrap meaningful long names, align a concise description and primary action, and share responsive spacing. Filters and secondary controls sit below the page heading. Loading skeletons follow final geometry; partial-query failures remain visible with retry.

## Compatibility and approval

The 2026-10-21 learned constraint in the brief governs appearance. `control`, `panel-inset`, `selection` and `chart-axis` are aliases of existing input/muted/accent/text tokens for the new workflows. They introduce no new palette. Keep owned component-state CSS and dependency removals. Standalone concept previews require selection before any app rollout.
