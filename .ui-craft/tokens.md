# Studio token contract

Authority: `apps/web/src/app/globals.css`, mapped into existing shadcn semantic variables. The `--studio-*` primitives feed semantic tokens; component variants reference those semantics. There is one theme provider and persisted `theme` choice (Light/Dark/System).

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #f7f8fa | #15171c |
| Card / popover / topbar | #ffffff | #1d2027 |
| Soft surface | #f4f6fa | #272d38 |
| Text | #20242c | #edf0f5 |
| Support | #667081 | #aeb8c9 |
| Group border | #e5e8ed | #343b47 |
| Input border | #c6ceda | #515e73 |
| Brand foreground | #285bd9 | #9bb8ff |
| Primary fill / text | #285bd9 / white | #3265df / white |
| Focus | #285bd9 | #a9c1ff |
| Accent surface | #eef3ff | #293854 |
| Success | #1d7053 | #79cba6 |
| Warning | #81500f | #e3b97c |
| Error | #a43b43 | #f2a1aa |

Inter body/headings; JetBrains Mono code; tabular numbers. Supporting type 12px+, body/forms 14px, sections16px, titles28/31px. Spacing uses the existing 4px grid. Controls7px, grouped surfaces11px, dialogs14px. Border grouping, minimal shadows, short hover/focus transitions and existing reduced-motion support. Keep saved accent overrides and logos; never use brand color for semantic health. Native color-scheme follows the resolved theme.

Light status text is darkened from the concept values to retain 4.5:1 contrast on actual translucent badge fills over both canvas and card surfaces. Dark semantic values remain unchanged. Touch dimensions live in the shared primitive classes so Radix trigger/form slots retain them. Narrow or enlarged headers expose search and account through the existing navigation sheet; one controlled command palette owns keyboard shortcuts.
