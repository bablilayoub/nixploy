# Migration and operator workflow milestones — 2026-10-15

Baseline: merged PR #14, `3b39c8e5220e442595db563e91df3fe491b9d240`. Branch: `codex/migration-workspace`; primary checkout remains untouched.

1. Panel reskin: shared page headers, dashboard projects/health/search, environment and service filters, creation and partial/error states. Verify desktop/mobile light/dark and dashboard soft navigation.
2. Migration center: live Dokploy API and uploaded dump, inventory selection, redacted fresh plan, explicit apply, partial results and concrete cutover tasks. No runtime/proxy effects on import.
3. Compose creation: raw URL, paste and upload, validation before insertion, explicit later deployment, clear fetch/safety failures.
4. Coolify template source: official upstream research, explicit translation/generation semantics, supported/rejected report and real deployment/redeploy proof.
5. Coolify migration: inspect actual official API and prove a supported live resource slice against an isolated source if feasible; otherwise expose only a proven useful path.
6. Readiness and handoff: contextual secret/data/server/registry/domain/deploy tasks, docs and generated API catalogue, full gates, browser evidence, scoped Docker smoke, coherent PR and CI remediation.

Each meaningful checkpoint updates `docs/status.md` with actual verification and gaps. No dependencies, production changes, release tags, unattributed Docker pruning, or public ACME claims.
