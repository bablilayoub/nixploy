# Releases

Nixploy PaaS ships via [GitHub Releases](https://github.com/bablilayoub/nixploy/releases)
(Dokploy-style): each tag builds the GHCR image, publishes release notes from merged PRs,
and attaches version-pinned `install.sh` / `update.sh`.

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

1. Bump `"version"` in the root [`package.json`](../package.json) (and keep `apps/web` / other workspace versions in sync if you treat them as the product version).
2. Commit on `main` with `[skip ci]` in the message so **CI** and **Docker** do not run on that push. Only the tag triggers packaging.
3. Tag and push:

```bash
VERSION=$(node -p "require('./package.json').version")
git commit -m "chore: release v${VERSION} [skip ci]"   # if the bump is not committed yet
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

1. Asserts tag ↔ `package.json`
2. Builds and pushes `ghcr.io/<repo>:vX.Y.Z` — plus `:latest` when the event is a tag push of a final version
3. Pins `install.sh` / `update.sh` defaults to that tag
4. Creates the GitHub Release (`generate_release_notes`; marked prerelease when the tag contains `-`) and uploads those scripts as assets

`main` pushes still build continuous images via [`.github/workflows/docker.yml`](../.github/workflows/docker.yml) (`main` + sha tags, never `latest`) — versioned tags and `latest` are owned by the Release workflow only.

### Re-run / repair

**Actions → Release → Run workflow** and pass an existing tag (e.g. `v0.1.0`) to rebuild the image and refresh the release assets. This re-tags `:vX.Y.Z` only; `:latest` stays where the newest tag push left it, so repairing an old release cannot downgrade installs that auto-update.

### `tools/release.sh` notes

`--bump` strips a prerelease/build suffix before bumping (`0.2.0-rc.1 --bump patch` → `0.2.0`, like `npm version`), and a `--version` equal to the current version skips the empty commit instead of failing.

## Install from a release

Prefer the asset from the release you want (defaults already pin `NIXPLOY_VERSION`):

```bash
# Example: pin to v0.1.0 release assets
curl -fsSL https://github.com/bablilayoub/nixploy/releases/download/v0.1.0/install.sh | sudo bash
```

Raw `main` URLs still work and track the branch default:

```bash
curl -fsSL https://raw.githubusercontent.com/bablilayoub/nixploy/main/install.sh | sudo bash
```

See [install.md](./install.md).

## CLI releases (separate)

`@nixploy/cli` publishes on tags `cli-v*` via [`.github/workflows/publish-cli.yml`](../.github/workflows/publish-cli.yml). That is independent of PaaS `v*` tags — bump and tag the CLI package when you want an npm release.
