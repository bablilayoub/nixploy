# Migration and operator workflow milestones — 2026-10-15

Baseline: merged PR #14, `3b39c8e5220e442595db563e91df3fe491b9d240`. Branch: `codex/migration-workspace`; primary checkout remains untouched.

1. Implemented and browser verified. Panel reskin: shared page headers, dashboard projects/health/search, environment and service filters, creation and partial/error states. Verify desktop/mobile light/dark and dashboard soft navigation.
2. Implemented; real API/dump and stale-result/credential tests pass. Migration center: live Dokploy API and uploaded dump, inventory selection, redacted fresh plan, explicit apply, partial results and concrete cutover tasks. No runtime/proxy effects on import.
3. Implemented and browser verified. Compose creation: raw URL, paste and upload, validation before insertion, explicit later deployment, clear fetch/safety failures.
4. Implemented/synced; real two-stack isolation, restart, rollback and preview cleanup pass. Coolify template source: official upstream research, explicit translation/generation semantics, supported/rejected report and real deployment/redeploy proof.
5. Implemented; official v4.4.6 API and browser proof pass. Coolify migration covers the supported configuration slice; explicitly started image/Postgres imports prove HTTP and fresh-password authentication. Unsupported engines/repository Compose applications and manual secrets/data steps remain explicit.
6. Local gates and production browser proof complete; exact-head PR #16 CI/handoff in progress: contextual secret/data/server/registry/domain/deploy tasks, docs and generated API catalogue, full gates, browser evidence, scoped Docker smoke, coherent PR and CI remediation.

Each meaningful checkpoint updates `docs/status.md` with actual verification and gaps. No dependencies, production changes, release tags, unattributed Docker pruning, or public ACME claims.


Confirmed follow-up during real template proof: Docker Compose's automatic bare
service-key DNS aliases can collide across stacks on the environment overlay.
Both engines now retain bare names only on private stack networks, qualify
deployed keys/shared aliases, preserve named-volume/project identity, support
existing label lookups and refuse unsafe anonymous-volume transitions. Verified two stacks
with distinct credentials/marker data, routing, redeploy/rollback and preview
cleanup, plus an actual anonymous-volume transition refusal preserving data.

Swarm counterpart proof also passes two real isolated installs, forced redeploy
and rollback, live legacy Deploy/rollback refusal without mutation, ordinary
legacy runtime controls, explicit Stop then immediate deployment with the same
named data, and an anonymous image-volume refusal. Overflowing Stack service
identities use a stable compact key; namespaces above 48 characters are rejected
and remain a documented constraint. Required template diagnostics never become
credential defaults, and ordinary cleared form values retain Compose semantics.
