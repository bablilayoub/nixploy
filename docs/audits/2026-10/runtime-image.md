# Runtime image hardening — October 20, 2026

Baseline: merged security PR #24, `e5a681b93dd019795444c18015ffde63b0b26440`.
The earlier amd64 CI scan reported **40 high / 0 critical** findings. That
report selected only those severities and inherited a repository ignore for
`CVE-2025-68121`; its 40 visible findings are not an unfiltered baseline.
Lower-severity and arm64 baseline counts were not established. The obsolete
ignore file is removed in this change; final native scans run without it.

## Installed components and changes

| Component | Baseline source | Runtime change |
| --- | --- | --- |
| libexpat 2.8.5-r0 | Git's Alpine dependency, stale cached installation | Supported Alpine 2.9.0-r0 minimum; package upgrades and a fresh CI cache argument |
| esbuild 0.25.12, 24 embedded-Go high findings | Better Auth's optional Drizzle Kit peer | Omit the schema generator and its exclusive compiler graph from the production artifact |
| TypeScript 7.0.2 native compiler, 14 high findings | tRPC type-checking peer in the production install graph | Omit the type checker and its exclusive native graph from the production artifact |
| braces 3.0.3, one unfixed high finding | shadcn development generator copied with the whole build store | Independent production installation omits the generator |
| tsx 4.23.13 and its active esbuild 0.28.1 | Custom server runtime | Supported tsx 4.23.15 and compatible esbuild 0.28.2 patch; retain native transpiler |

The older esbuild was **not** tsx's active compiler. Updating tsx alone would
not remove its 24 findings. TypeScript and Drizzle Kit remain legitimate
development dependencies in the source checkout; this change does not forge
their package metadata, force unsupported versions, alter peer installation
settings or hide scanner findings. The pruner follows production web/server
dependencies, optional native packages and runtime peers; the three explicit
build-only peer exclusions are TypeScript, Drizzle Kit and Vitest. A direct
runtime dependency on one of those names fails the packaging step.

The first production graph retained 497 packages and omitted 77. Image
contents include the compiled Next application, server/worker sources,
workspace links, root TypeScript configuration for tsx, runtime native
packages, migrations and their independent pinned runner. Docker CLI,
Buildx, Compose, Git, SSH, PostgreSQL client, curl and timezone data remain.

A newly indexed Windows launch-editor advisory also affects the development
Vite peer. The lock uses the supported 8.1.5 → 8.1.6 patch with identical
dependency/peer/engine requirements, within Vitest’s declared Vite 8 range.
Vite is omitted from the runtime graph; no direct dependency or override is
added. [Upstream advisory](https://github.com/advisories/GHSA-698v-4r3x-3vcv).

## Verification checkpoint

| Architecture | Actual image scan, all severities | Runtime proof |
| --- | --- | --- |
| arm64 | Trivy 0.70.0: 0 critical, 0 high, 0 medium, 0 low, 0 unknown; Alpine 3.24.2, 48 OS packages and 530 Node packages inspected | Migration from an empty isolated Postgres, separate worker/panel readiness, real owner/auth/org/API key creation and queued image deployment passed. Combined-role queued Git/Dockerfile build/deploy, repeated migrator, encryption rotation dry-run and an installed npm CLI package/bin also passed. |
| amd64 | Pending exact-head CI | Pending exact-head native CI, including source build and real-Swarm golden path |

Three packaging regressions cover native/workspace dependency retention,
idempotent pruning, and failing before deletion on missing runtime dependencies
or newly required build tools. Workspace types, strict Biome, 3,306 server tests (one optional registry probe skipped), 118 web tests and 94 CLI tests pass locally, including rechecking the final Vite development-tool patch. Vite is omitted from the runtime image. Exact-head CI and independent review
remain required before merge. No production host, version tag or release is
manually changed by this verification.

Every native CI image is scanned at all severities, with the complete JSON
report retained as an artifact. A separate enforced HIGH/CRITICAL scan has
exit code 1 and includes unfixed findings. Both publication workflows gate
each architecture's digest before manifest assembly/signing. Base pulls and
per-run/attempt Alpine refresh arguments prevent an unchanged cached `apk`
layer from indefinitely retaining a package with an available patch.

Independent review caught the inherited ignore after the first candidate
was frozen. That candidate is superseded; its CI scans cannot establish
unfiltered results. The local containerized arm64 scan ran outside the
repository working directory, and is repeated with an explicit empty ignore
file. Both native CI architectures must pass again at the corrected head.

The image supports the direct runtime migrator and direct web tsx encryption
rotator documented in `docker/README.md` and `docs/auth.md`. Development
commands that generate schemas, compile/check TypeScript or run tests belong
in the source checkout. The npm CLI is a separately built artifact.

## Limits

These are dated scanner observations, not a promise that the image or host is
free of all vulnerabilities. The workspace's development graph and host Node
runtime are separate from the runtime artifact. The remaining development
advisories and the observed older host Node are documented in the
[security follow-up](security-follow-up.md); this work neither updates the
user's global runtime nor restarts their primary panel. Existing source/image
deploy and Docker/SSH paths are preserved; no new dependency or advisory
suppression is added.

Primary upstream evidence: [Alpine libexpat](https://pkgs.alpinelinux.org/package/v3.24/main/x86_64/libexpat),
[Expat 2.9.0 changes](https://github.com/libexpat/libexpat/blob/R_2_9_0/expat/Changes),
[tsx 4.23.15](https://github.com/privatenumber/tsx/releases/tag/v4.23.15).
