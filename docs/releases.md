# Releases

Nixploy PaaS ships via [GitHub Releases](https://github.com/bablilayoub/nixploy/releases)
(Dokploy-style): each tag runs the quality gate, builds the multi-arch GHCR image
(`linux/amd64` + `linux/arm64`, with provenance and SBOM attestations), scans it with
Trivy, signs it with cosign, publishes release notes, and attaches version-pinned
`install.sh` / `update.sh` / `uninstall.sh` plus a `SHA256SUMS` file.

## Version convention

| Place | Format | Example |
| --- | --- | --- |
| Root `package.json` (and app packages) | Semver, no `v` | `0.1.0` |
| Git tag | `v` + semver | `v0.1.0` |
| GHCR image tags | `vX.Y.Z` (+ `latest` for final releases) | `ghcr.io/bablilayoub/nixploy:v0.1.0` |
| `NIXPLOY_VERSION` | Same as git tag | `v0.1.0` |

CI fails if the tag does not match `v` + `package.json` version.

## Image channels

| Tag | Moved by | Meaning |
| --- | --- | --- |
| `vX.Y.Z` | Release workflow (tag push or re-run) | Immutable release; what `install.sh` / `update.sh` pin |
| `latest` | Release workflow, **tag push of a final `vX.Y.Z` only** | Release channel tracked by the in-app updater (Settings → Platform → Updates) |
| `main`, `<sha>` | Docker workflow on every `main` push | Continuous builds for testing; never `latest` |

`latest` therefore only advances when a real release is tagged: `main` pushes
and `workflow_dispatch` re-runs of an older tag (asset repair) never move it,
and prerelease tags (`v0.2.0-rc.1`) are published as GitHub prereleases
without touching it. Installs pin `NIXPLOY_VERSION` and pass the exact image
ref to the panel as `NIXPLOY_IMAGE`.

## Cut a release

0. Write the release down **before** tagging: move the `[Unreleased]` section
   of [`CHANGELOG.md`](../CHANGELOG.md) under the new version, and give any
   change that alters a default, removes a procedure or needs an operator
   action its own entry in [`upgrade-notes.md`](./upgrade-notes.md). The
   auto-generated GitHub notes are built from merged PRs and this repository
   takes direct commits, so they come out empty — these two files *are* the
   release notes.
1. Bump `"version"` in the root [`package.json`](../package.json) (and keep `apps/web` / other workspace versions in sync if you treat them as the product version).
2. Commit on `main` with `[release]` in the message so **CI** and **Docker** skip that push (their `if:` guards look for it). Do **not** use `[release]`: GitHub applies it to the tag push as well, so the Release workflow is silently skipped — that is what happened to the first v0.2.0 tag.
3. Tag and push:

```bash
VERSION=$(node -p "require('./package.json').version")
git commit -m "chore: release v${VERSION} [release]"   # if the bump is not committed yet
git tag "v${VERSION}"
git push origin HEAD "v${VERSION}"
```

Tag → workflow map (they do not overlap):

| Tag | Workflow |
| --- | --- |
| `v0.1.1` (`v[0-9]*`) | **Release** — GHCR + GitHub Release |
| `cli-v0.1.2` (`cli-v*`) | **Publish CLI** — npm only |

4. Watch **Actions → Release**. When it finishes, open
   [github.com/bablilayoub/nixploy/releases](https://github.com/bablilayoub/nixploy/releases).

### What CI does

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

1. **Quality gate** — the `checks` job calls the reusable
   [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) on the tagged ref:
   `pnpm typecheck` (all workspaces), the Biome CI command, `pnpm test:db` with
   `DATABASE_URL_TEST` against a Postgres 17 service (so the tenancy-isolation suite
   really runs — `test:db` refuses to start without that variable), `pnpm -F @nixploy/cli
   test`, the web tests when that package has a `test` script, and the Traefik
   static-config drift check. The same workflow gates every PR, so the release gate cannot
   drift from CI. The `release` job `needs:` it; a red tree never reaches `:latest`.
2. Asserts tag ↔ `package.json`
3. Builds and pushes `ghcr.io/<repo>:vX.Y.Z` for `linux/amd64` **and** `linux/arm64`.
   arm64 is emulated with QEMU on the amd64 runner, so the release build is slow (expect
   20–40 minutes cold; the GHA layer cache helps on re-runs). Native `ubuntu-24.04-arm`
   runners + a manifest merge are the upgrade path if that becomes painful.
4. Attaches a SLSA **provenance** attestation and an SPDX **SBOM** to the image
   (`provenance: true`, `sbom: true`) and stamps the OCI labels
   (`org.opencontainers.image.source|revision|version|created`) from
   `docker/metadata-action`. The attestations appear as extra `unknown/unknown` platform
   entries in the GHCR UI — that is expected. Inspect with
   `docker buildx imagetools inspect ghcr.io/bablilayoub/nixploy:vX.Y.Z`.
5. **Trivy scan of the pushed digest**, `severity: CRITICAL`, `ignore-unfixed: true`,
   `exit-code: 1`. A fixable critical CVE fails the release. (PRs run a wider but advisory
   `CRITICAL,HIGH` scan — see [development.md](./development.md).)
6. **cosign keyless signature** of the digest (`cosign sign --yes`). The workflow's OIDC
   identity is bound into a short-lived Fulcio certificate and the signature is recorded in
   the Rekor transparency log — no private key exists to leak or rotate. See *Verify what
   you are running* below.
7. **Moves `:latest`** — only for a tag push of a final `vX.Y.Z`, and only now, after the
   scan and the signature. `docker buildx imagetools create` re-tags the manifest that was
   just built, so `:latest` and `:vX.Y.Z` are the same bytes by construction and a failed
   scan cannot advance the channel every install auto-updates to.
8. Pins `install.sh` / `update.sh` defaults to that tag
9. Writes `SHA256SUMS` over `install.sh`, `update.sh` and `uninstall.sh` **after** the
   pinning step, so the checksums match the assets the release actually serves
10. Creates the GitHub Release (`generate_release_notes`; marked prerelease when the tag
    contains `-`) and uploads the three scripts plus `SHA256SUMS` as assets

### Verify what you are running

The image is signed keyless, so verification needs no key — only the identity that was
allowed to sign:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github\.com/bablilayoub/nixploy/\.github/workflows/(release|docker)\.yml@refs/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/bablilayoub/nixploy:v0.1.0 | jq .
```

Both `release.yml` (tagged releases, `:vX.Y.Z` and `:latest`) and `docker.yml` (continuous
`:main` / `:<sha>` builds) sign their digests. Tighten the regexp to `release.yml` alone if
you only ever run releases.

Installer scripts are verified against the release's `SHA256SUMS` before being run as root
— the recipe lives in [install.md](./install.md).

### Actions are SHA-pinned

Every third-party action is referenced by commit SHA with the version in a trailing comment
(`uses: owner/repo@<sha> # v1.2.3`). A moving tag is a supply-chain hole: whoever controls
the action's repository can repoint `@v4` at new code that runs with this workflow's
`packages: write` and `id-token: write` permissions. [Dependabot](../.github/dependabot.yml)
opens a weekly PR that bumps the SHAs and the comments together, so pinning does not mean
going stale.

`main` pushes still build continuous images via
[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) (`main` + sha tags, never
`latest`; also multi-arch with provenance + SBOM, and cosign-signed) — versioned tags and
`latest` are owned by the Release workflow only. Continuous builds do **not** wait for the
CI gate; they are throwaway images for testing.

Supported image architectures: `linux/amd64`, `linux/arm64` (Raspberry Pi 4/5, Ampere,
Graviton, Apple-silicon Docker). `install.sh` already accepts both; before this an arm64 host
silently fell back to a multi-minute source build.

### Re-run / repair

**Actions → Release → Run workflow** and pass an existing tag (e.g. `v0.1.0`) to rebuild the image and refresh the release assets. This re-tags `:vX.Y.Z` only; `:latest` stays where the newest tag push left it, so repairing an old release cannot downgrade installs that auto-update.

### `tools/release.sh` notes

- Before creating a tag it runs the same gate as CI: `pnpm typecheck`,
  `pnpm exec biome check packages/server apps/web apps/cli apps/landing`, `pnpm test`.
  Export `DATABASE_URL_TEST` (see `CLAUDE.md`) if you want the tenancy suite locally; otherwise
  it is skipped with a note and the Release workflow runs it against Postgres 17 anyway.
  `--skip-checks` bypasses the local gate with a loud warning (the CI gate still stands).
  `--dry-run` prints the check commands instead of running them.
- `--bump` strips a prerelease/build suffix before bumping (`0.2.0-rc.1 --bump patch` →
  `0.2.0`, like `npm version`), and a `--version` equal to the current version skips the
  empty commit instead of failing.

## Install from a release

Prefer the asset from the release you want (defaults already pin `NIXPLOY_VERSION`):

```bash
# Example: pin to v0.1.0 release assets
curl -fsSL https://github.com/bablilayoub/nixploy/releases/download/v0.1.0/install.sh | sudo bash
```

That pipes a script straight into root's shell. Every release also ships `SHA256SUMS`, so
the safe form is download → verify → run; see the snippet in [install.md](./install.md).

Raw `main` URLs still work and track the branch default:

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

See [install.md](./install.md).

## CLI releases (separate)

`@nixploy/cli` publishes on tags `cli-v*` via [`.github/workflows/publish-cli.yml`](../.github/workflows/publish-cli.yml). That is independent of PaaS `v*` tags — bump and tag the CLI package when you want an npm release.
