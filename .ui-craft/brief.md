# Product purpose

Nixploy deploys and operates applications, Compose stacks and databases on the operator's own Docker Swarm servers.

# Primary user

A developer or small-team operator managing production services from a laptop, with a phone used for status checks and recovery.

# Principles

1. An unverified state must look unfinished: imports, templates and deployments distinguish saved configuration from a running service.
2. Review before changing infrastructure: source selection, target, redacted changes and manual work remain visible before apply.
3. Keep operational information close: service names, environment, health and next action belong together; failures never look empty.
4. Neutral chrome carries functional color: preserve the organization accent, use semantic colors for state, and spend space on readable data.
5. Keep learned navigation intact: preserve routes, deep links, service tab order, command palette and capability gates.

# Success criteria

An operator can find a failing service on desktop or phone, create a service from existing Compose, and review then import a selected source environment without accidentally deploying it. Import results identify the remaining secrets, data, server, routing and deployment work.

# Scope

- Reskin shared panel seams and dashboard/project creation surfaces while retaining their information architecture.
- Preserve the existing Inter and JetBrains Mono fonts, neutral light/dark palette and organization branding.
- Hover and focus motion only; no decorative entrance sequences.
- Marketing structure and vendored registry components remain governed by the landing app's existing contract.
- Production host changes, public DNS/ACME and same-host takeover are outside this implementation.

# Learned constraints

- 2026-10-15: Product/design decisions are delegated; use repository evidence and the calm operator-panel direction without waiting for discovery answers.
- Craft 8, motion 2, density 6, variance 4. Signature: a compact review-to-next-action workflow, with keyboard access through the existing command palette.
