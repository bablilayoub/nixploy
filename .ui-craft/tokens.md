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
