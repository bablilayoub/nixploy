# Fieldwork token spine

| Role | Light | Dark |
|---|---|---|
| Canvas | #f6f7f8 | #17191c |
| Working surface | #ffffff | #202327 |
| Overlay | #ffffff | #2a2e33 |
| Inset | #f0f2f4 | #1a1c20 |
| Foreground | #202327 | #f0f2f4 |
| Supporting text | #616973 | #abb1ba |
| Divider | #e0e4e8 | #383e46 |
| Input boundary | #8a939f | #737f8f |
| Primary | #24272b | #eceff2 |
| Focus | #6b7480 | #a3afbc |

Semantic success/warning/error retain readable colors and explicit labels; branding overrides remain intact. Primitive/semantic/component tokens, no duplicate theme provider. Use Geist UI and Geist Mono code. Body14px, supporting12px, section16px, intermediate20px, page32px weight500; 11px allowed only for compact counts/ticks. Marketing14/18/30/64. Spacing4/8/12/16/20/24/32/40/48/64px, fixed pixel layout spacing with rem text and wrapping so enlarged text has room. Control radius6px, object card10–12px, overlay16px. Desktop controls36–40px; coarse44px. Borders separate; shadows only at meaningful elevation. White card/overlay fills intentionally share a light fill and use backdrop/border/shadow to distinguish overlays. Motion120–180ms on state change only, no repeated entrance choreography.


## Public website Signal tokens — 2026-10-23

These override marketing only. Panel token table above remains authoritative.
Canvas light #f5f6f8/dark #0b0d11; surface #fff/#12151b; elevated #fff/#1c2028;
ink #14181f/#f4f5f7; secondary #555f6d/#a9b2c0; border #dce0e6/#2b313c;
primary #bc3e17/#ff895c with white/#1b100b text. Radial orange light is a hero
atmosphere, not a content background. Fine grid belongs only to hero/page mastheads.
Display clamp44–96px, section32–52px, body16–18px, code13–14px, labels12px.
Controls6–8px, cards12px, product/diagramframes20px. Motion opacity150ms,
controls180ms, entrance400–550ms, staggers60ms; pause/reduced-motion stop travel.


## Monochrome library authority — 2026-10-23

Both applications use the same achromatic ramp: light canvas #fafafa, surface and
popover #ffffff, foreground/primary #171717, secondary/inset #f5f5f5, muted text
#636363, divider #e5e5e5, input #8a8a8a. Dark canvas #0a0a0a, surface #141414,
overlay #1c1c1c, primary/foreground #fafafa, secondary/inset #222222, muted text
#b3b3b3, divider #303030, input #737373. Status semantics use neutral tones plus
explicit labels/icons; chart series use distinct gray levels and labels. Brand
icons may keep authentic colors. Saved custom branding values are preserved.
Geist and Geist Mono remain; no new font or component runtime dependency.

## Mobbin-reference geometry

White #fff / graphite #141414 canvases; foreground #141414 / #fafafa. Soft panels
#f5f5f5 / #222222, subdued boundaries #eaeaea / #333333. Supporting text #707070 /
#b3b3b3. Geist650 display and600 controls;80/80 hero,44/48 section,56/56 close on
desktop with fluid mobile sizes. Full-pill actions/nav;12px inputs,20px cards,
24px dialog/image panels,32px large preview shell. Light/dark/System persist.

## Focused actual app geometry — 2026-10-23

App-only override: canvas #ffffff / #212121, sidebar #f9f9f9 / #171717,
surface #ffffff / #262626, inset #f5f5f5 / #2b2b2b, foreground #141414 / #fafafa.
Keep existing accessible supporting text/input/focus values and neutral chart/status
semantics. Existing branding data is retained. Geist14px body,12px support,
16px section,24–28px page title. Primary content max1280px; settings max1040px.
Controls8px; collection surfaces12px; overlays16px; icon buttons circular.
Spacing4/8/12/16/20/24/32/40; forms grouped by task with dividers, no card nesting.
Hover/focus120–150ms only, OS reduced motion respected. Desktop controls36–40px,
touch44px. Working forms use library behavior and the existing save/dirty guards.

## Latest app authority — shadcn New York/Zinc defaults

All earlier app theme tables are historical and superseded. `apps/web/components.json`
selects `new-york` and `zinc`; use the official registry's `inlineColors.light` and
`inlineColors.dark` from https://ui.shadcn.com/r/colors/zinc.json verbatim, with its
0.625rem base radius and standard derived radius scale. Library source comes from
https://ui.shadcn.com/r/styles/new-york-v4/{component}.json. Do not introduce another
palette, shadows, rounded pill skin, or override `data-slot` presentation globally.
Existing legacy token names are aliases to stock semantic values, not a second theme.
Only operational layout and accessibility rules remain outside the registry source.
