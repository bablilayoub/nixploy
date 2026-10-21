# Product purpose

Nixploy deploys and operates applications, Compose stacks and databases on the operator's own Docker Swarm servers.

# Primary user

A developer or small-team operator managing production services from a laptop, with a phone used for status checks and recovery.

# Principles

1. An unverified state must look unfinished: imports, templates and deployments distinguish saved configuration from a running service.
2. Review before changing infrastructure: source selection, target, redacted changes and manual work remain visible before apply.
3. Keep operational information close: service names, environment, health and next action belong together; failures never look empty.
4. Keep the familiar stone/zinc monochrome app, Inter and JetBrains Mono, existing horizontal navigation and saved branding. Present distinct concepts for selection before any future aesthetic rollout.
5. Keep learned navigation intact: preserve routes, deep links, service tab order, command palette and capability gates.

# Success criteria

An operator can find the service needing attention, identify its environment and current state, inspect evidence, and take the next permitted action on desktop or phone. Editing, deployment and recovery clearly distinguish a draft, an in-flight operation and a verified result.

# Scope

- Preserve the real app's familiar visual identity, shared primitives and navigation. Add functional workflows and useful accessibility/mobile corrections within that design.
- Offer three to five clearly distinct modern dashboard concepts as standalone sample-data previews. Wait for the user's selection before changing app appearance; preserve instance/organization logos and accent colors.
- Hover and focus motion only; no decorative entrance sequences.
- Marketing structure and vendored registry components remain governed by the landing app's existing contract.
- Production host changes, public DNS/ACME and same-host takeover are outside this implementation.

# Learned constraints

- 2026-10-15: Functional product decisions are delegated; use repository evidence without waiting for discovery answers. Aesthetic delegation is superseded by the 2026-10-21 requirement to compare standalone concepts before an app appearance change.
- **2026-10-20 — Deprecated 2026-10-21:** The earlier replacement-design direction delegated palette/font choices. *Deprecation reason:* the user rejected the resulting mineral/plum/IBM Plex overhaul and reinstated the familiar app design.
- **2026-10-20 — Deprecated 2026-10-21:** Craft 8/motion 2/density 7/variance 5 and the status-spine signature described the rejected overhaul; do not apply them to the real app.

- **2026-10-21** — Retain the existing familiar visual design in the real app. The rejected mineral/plum/IBM Plex overhaul must not ship. Preserve functional/security fixes, useful UX corrections and safe owned CSS/dependency removals. Offer **three to five clearly distinct modern dashboard concept previews** for the user to compare and select before any future aesthetic rollout. *Why:* the user explicitly dislikes the redesign and wants comparison and choice. This supersedes conflicting prior aesthetic directions; accessibility and correctness remain required.

- **2026-10-21 — Deprecated prior principle 4:** ~~A distinctive workspace supports concentration: cool mineral surfaces, plum actions and IBM Plex typography establish the default identity; the saved organization accent remains authoritative.~~ *Why:* the user rejected that visual overhaul and wants the familiar design retained while comparing standalone concepts.

- **2026-10-21 — Studio selection deprecated; restore familiar panel:** The earlier “go with Studio” choice is superseded. Restore the panel appearance from before PR #30 and retain its existing Light/Dark/System preferences, Inter/mono typography and saved branding. Do not reapply Studio without a new explicit request. *Why:* after viewing the live Studio rollout, the user requested “rollback the old design.” Preserve all earlier feature/security changes.
