# Mobbin reference — 2026-10-23

The user supplied a full-page screenshot and explicitly requested Mobbin's design
system for Nixploy, with both light and dark modes. The live [Mobbin homepage](https://mobbin.com/)
was inspected with the web reader and a browser at1440px. This is an observed
visual-system study, not a claim that Mobbin publishes these as reusable tokens.

## Observed rules and Nixploy mapping

| Reference observation | Nixploy implementation |
| --- | --- |
| Saans variable font,80/80px display at weight652;44/48px section headings;56/56px closing headline | Existing Geist,650 display weight and matched hierarchy/proportions. No external font dependency or licensed font file added. |
| Centered three-line headline containing small authentic app marks | Nixploy's apps/databases/servers message with actual n8n/PostgreSQL/Docker marks. Brand-image failures have a letter fallback; neutral brand marks invert correctly in light mode. |
|44px full-pill primary/secondary actions | Existing shadcn Button variants and composition rules; operational icon/compact controls retain their contexts and touch rules. |
| White/#141414 canvas/foreground, soft-gray image panels and few outlines | Shared white/graphite semantic roles in both apps. Supporting text is slightly stronger than the sampled reference to pass contrast on gray panels. |
| Large preview below headline, image gallery, six image-led tiles | Real example workspace Tabs, reused Magic UI Marquee/BentoGrid and shadcn Cards. No invented product UI or customer proof. |
| Split agent section, gray support band, centered final action | Actual MCP documentation and permission-scoped tool explanation, existing open-platform features, copyable install command. |
| Small simple header, generous section rhythm, dark close | Existing functional navigation/search/theme/pause/mobile dialog, shared centered page headers and a dark sitemap with local tokens/visible logo. |

The live homepage's measured font/computed values and screenshots are retained
privately under `.nixploy-data/verification/mobbin-system/`. The user's supplied
image remains the visual authority when live content differs. Its customer
stories and product screenshots are not Nixploy evidence and are not reused.

## Scope and preservation

The actual Next.js app inherits the same surfaces, panel/control geometry,
typography, active-navigation pills, settings Cards and neutral statuses. Its
resource tables, responsive sidebar, URL-synced service tabs, form callbacks,
permissions, dirty guards, theme/branding settings and query contracts stay intact.
The palette change exposed two real state/control issues: skeleton fills needed
foreground tint, and slider tracks needed the existing input token. Both were
fixed and independently verified. Enlarged text adapts overview columns rather
than letting metric labels spill out of cards.

The implementation continues using the existing shadcn/Radix/Magic UI/Motion
stack researched in [monochrome-libraries.md](monochrome-libraries.md). No runtime
package or framework version changes belong to this visual pass.
