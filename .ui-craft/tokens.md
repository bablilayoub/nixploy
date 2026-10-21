# Monochrome token spine

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #f4f4f5 | #090a0b |
| Working surface | #ffffff | #111315 |
| Raised / overlay | #ffffff | #1b1d20 |
| Inset / controls | #f7f7f8 | #0d0f11 |
| Foreground | #17181b | #f5f5f6 |
| Supporting text | #62666f | #a0a5ae |
| Border | #dedfe3 | #2a2d32 |
| Control boundary | #858b95 | #5c636e |
| Primary | #191b1f / white text | #f4f5f6 / near-black text |
| Selection | #eceef0 | #26292e |
| Focus | #737984 | #a8aeb9 |

Use existing semantic Tailwind tokens and a single provider. Preserve saved brand overrides. Functional success/warning/error/info colors have readable foregrounds and neutral/tinted surfaces; no decorative rainbow. Chart series are monochrome opacity steps, with real status distinctions only.

Inter for UI and headings; JetBrains Mono for code/operational identifiers. Display 28–36px, section 16–18px, body14px, supporting12–13px, mobile form inputs16px. Tabular numerals throughout operational views. Spacing 4/8/12/16/24/32/48px on a fixed 4px layout grid; text can grow independently and controls expand vertically. Controls8px radius, cards14px, dialogs20px. Desktop controls36–40px; coarse-pointer targets44px minimum including wrappers and icon controls. Motion100–180ms, reduced-motion removes spatial transitions. Recessed surfaces use neutral inset highlights and two-layer shadows.
