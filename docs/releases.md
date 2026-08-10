# Releases

Nixploy PaaS ships via [GitHub Releases](https://github.com/bablilayoub/nixploy/releases)
(Dokploy-style): each tag builds the GHCR image, publishes release notes from merged PRs,
and attaches version-pinned `install.sh` / `update.sh`.

## Version convention

| Place | Format | Example |
| --- | --- | --- |
| Root `package.json` (and app packages) | Semver, no `v` | `0.1.0` |
| Git tag | `v` + semver | `v0.1.0` |
| GHCR image tags | `vX.Y.Z` and `latest` | `ghcr.io/bablilayoub/nixploy:v0.1.0` |
| `NIXPLOY_VERSION` | Same as git tag | `v0.1.0` |

CI fails if the tag does not match `v` + `package.json` version.

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
2. Builds and pushes `ghcr.io/<repo>:vX.Y.Z` and `:latest`
3. Pins `install.sh` / `update.sh` defaults to that tag
4. Creates the GitHub Release (`generate_release_notes`) and uploads those scripts as assets

`main` pushes still build continuous images via [`.github/workflows/docker.yml`](../.github/workflows/docker.yml) (`latest` + sha) — versioned tags are owned by the Release workflow only.

### Re-run / repair

**Actions → Release → Run workflow** and pass an existing tag (e.g. `v0.1.0`) to rebuild the image and refresh the release assets.

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
