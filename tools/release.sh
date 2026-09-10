#!/usr/bin/env bash
#
# Cut a Nixploy PaaS and/or CLI release from your machine.
#
# Usage:
#   ./tools/release.sh paas                 # tag+push vX.Y.Z from current package.json
#   ./tools/release.sh cli                  # tag+push cli-vX.Y.Z from apps/cli
#   ./tools/release.sh both                 # PaaS then CLI (independent versions)
#   ./tools/release.sh paas --bump patch    # bump, commit, tag, push
#   ./tools/release.sh cli --bump minor
#   ./tools/release.sh paas --dry-run
#
# Flags:
#   --bump patch|minor|major   Semver bump before tagging (commits the bump)
#   --version X.Y.Z            Set exact version (no leading v) instead of --bump
#   --dry-run                  Print actions; do not commit/tag/push
#   --no-push                  Commit/tag locally only
#   --yes                      Skip confirmation
#   --skip-checks              Tag without typecheck / biome / tests (not recommended)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET=""
BUMP=""
SET_VERSION=""
DRY_RUN=0
NO_PUSH=0
YES=0
SKIP_CHECKS=0
CHECKS_DONE=0

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

usage() {
	cat <<'EOF'
Cut a Nixploy PaaS and/or CLI release from your machine.

Usage:
  ./tools/release.sh paas                 # tag+push vX.Y.Z from current package.json
  ./tools/release.sh cli                  # tag+push cli-vX.Y.Z from apps/cli
  ./tools/release.sh both                 # PaaS then CLI (independent versions)
  ./tools/release.sh paas --bump patch    # bump, commit, tag, push
  ./tools/release.sh cli --bump minor
  ./tools/release.sh paas --dry-run

Flags:
  --bump patch|minor|major   Semver bump before tagging (commits the bump)
  --version X.Y.Z            Set exact version (no leading v) instead of --bump
  --dry-run                  Print actions; do not commit/tag/push
  --no-push                  Commit/tag locally only
  --yes                      Skip confirmation
  --skip-checks              Tag without typecheck / biome / tests (not recommended)
EOF
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		paas | cli | both | nixploy)
			[[ -z "$TARGET" ]] || die "target already set to $TARGET"
			TARGET="$1"
			[[ "$TARGET" == "nixploy" ]] && TARGET=paas
			shift
			;;
		--bump)
			BUMP="${2:-}"
			[[ "$BUMP" == "patch" || "$BUMP" == "minor" || "$BUMP" == "major" ]] ||
				die "--bump must be patch|minor|major"
			shift 2
			;;
		--version)
			SET_VERSION="${2:-}"
			[[ "$SET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.+]+)?$ ]] ||
				die "--version must be semver without leading v (got: $SET_VERSION)"
			shift 2
			;;
		--dry-run) DRY_RUN=1; shift ;;
		--no-push) NO_PUSH=1; shift ;;
		--yes | -y) YES=1; shift ;;
		--skip-checks) SKIP_CHECKS=1; shift ;;
		-h | --help) usage 0 ;;
		*) die "unknown arg: $1 (try --help)" ;;
	esac
done

[[ -n "$TARGET" ]] || usage 1
[[ -z "$BUMP" || -z "$SET_VERSION" ]] || die "use either --bump or --version, not both"

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }
need git
need node
need pnpm

run() {
	if [[ "$DRY_RUN" -eq 1 ]]; then
		printf '+ %s\n' "$*"
	else
		"$@"
	fi
}

read_version() {
	node -p "require('$1').version"
}

bump_semver() {
	local current="$1" kind="$2"
	node -e "
		const raw = process.argv[1];
		const k = process.argv[2];
		// Prerelease/build suffixes (0.2.0-rc.1, 0.2.0+build) are stripped before
		// bumping: Number('0-rc.1') is NaN and would tag v0.2.NaN. Like npm
		// version, 'patch' on a prerelease finalizes it (0.2.0-rc.1 → 0.2.0).
		const core = raw.split(/[-+]/)[0];
		const parts = core.split('.').map(Number);
		if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
			console.error('cannot bump non-semver version: ' + raw);
			process.exit(1);
		}
		const [maj, min, pat] = parts;
		const prerelease = core !== raw;
		let next;
		if (k === 'major') next = [maj + 1, 0, 0];
		else if (k === 'minor') next = [maj, min + 1, 0];
		else next = prerelease ? [maj, min, pat] : [maj, min, pat + 1];
		process.stdout.write(next.join('.'));
	" "$current" "$kind"
}

set_json_version() {
	local file="$1" version="$2"
	node -e "
		const fs = require('fs');
		const p = process.argv[1];
		const v = process.argv[2];
		const j = JSON.parse(fs.readFileSync(p, 'utf8'));
		j.version = v;
		fs.writeFileSync(p, JSON.stringify(j, null, '\t') + '\n');
	" "$file" "$version"
}

# Keep install/update defaults aligned with the PaaS tag.
pin_install_defaults() {
	local tag="$1"
	local file
	for file in install.sh update.sh; do
		sed -i.bak "s|^NIXPLOY_VERSION=\"\${NIXPLOY_VERSION:-v[^\"]*}\"|NIXPLOY_VERSION=\"\${NIXPLOY_VERSION:-${tag}}\"|" "$file"
		rm -f "${file}.bak"
	done
}

confirm() {
	local msg="$1"
	[[ "$YES" -eq 1 || "$DRY_RUN" -eq 1 ]] && return 0
	printf '%s [y/N] ' "$msg"
	read -r ans
	[[ "$ans" == "y" || "$ans" == "Y" ]] || die "aborted"
}

# Quality gate — the same commands CI runs in .github/workflows/checks.yml
# (there against Postgres 17, so the tenancy suite only runs locally when
# DATABASE_URL_TEST is exported). A tag push builds the :latest channel that
# every install auto-updates to, so never tag a red tree. Runs once per
# invocation (`both` shares it).
run_checks() {
	[[ "$CHECKS_DONE" -eq 0 ]] || return 0
	CHECKS_DONE=1
	if [[ "$SKIP_CHECKS" -eq 1 ]]; then
		printf '\033[1;31mWARNING: --skip-checks — tagging without typecheck / biome / tests.\033[0m\n' >&2
		printf '\033[1;31m         Only the CI release gate now stands between this tag and :latest.\033[0m\n' >&2
		return 0
	fi
	bold "Checks (typecheck, biome, tests)"
	if [[ -z "${DATABASE_URL_TEST:-}" ]]; then
		info "DATABASE_URL_TEST is unset — the tenancy suite is skipped locally (CI runs it against Postgres 17)"
	fi
	run pnpm typecheck || die "typecheck failed — fix before releasing"
	run pnpm exec biome check packages/server apps/web apps/cli apps/landing || die "biome failed — fix before releasing"
	run pnpm test || die "tests failed — fix before releasing"
}

ensure_clean_enough() {
	# Allow the release script's own staged/unstaged version edits only after we start.
	if [[ -n "$(git status --porcelain)" && "$DRY_RUN" -eq 0 ]]; then
		die "working tree is dirty — commit or stash first"
	fi
}

# Push only what is needed so we don't kick off CI/Docker/etc.
# Version commits use [skip ci]. Tag push alone runs Release or Publish CLI.
push_release() {
	local tag="$1"
	if [[ "$NO_PUSH" -eq 1 ]]; then
		info "skipped push (--no-push); local tag $tag"
		return
	fi
	# Push commits first (if any). [skip ci] in the message prevents CI + Docker.
	if [[ "$DRY_RUN" -eq 1 ]]; then
		printf '+ git push origin HEAD   # commit should include [skip ci]\n'
		printf '+ git push origin %s   # only Release / Publish CLI for this tag\n' "$tag"
		return
	fi
	local ahead
	ahead="$(git rev-list --count "origin/$(git rev-parse --abbrev-ref HEAD)..HEAD" 2>/dev/null || echo 1)"
	if [[ "$ahead" != "0" ]]; then
		git push origin HEAD
	else
		info "branch already on origin — skipping commit push"
	fi
	git push origin "refs/tags/${tag}"
}

release_paas() {
	local pkg="$ROOT/package.json"
	local current next tag
	current="$(read_version "$pkg")"
	if [[ -n "$SET_VERSION" ]]; then
		next="$SET_VERSION"
	elif [[ -n "$BUMP" ]]; then
		next="$(bump_semver "$current" "$BUMP")"
	else
		next="$current"
	fi
	tag="v${next}"

	bold "PaaS release → $tag"
	info "package.json: $current → $next"
	info "Actions: only workflow Release (not CI / Docker / Publish CLI)"

	if git rev-parse "$tag" >/dev/null 2>&1; then
		die "tag $tag already exists locally"
	fi
	if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
		die "tag $tag already exists on origin"
	fi

	confirm "Create PaaS release $tag?"
	run_checks

	if [[ "$next" != "$current" || -n "$BUMP" || -n "$SET_VERSION" ]]; then
		if [[ "$DRY_RUN" -eq 1 ]]; then
			info "would set version $next in root + apps/web + apps/landing + packages/server"
			info "would pin install.sh / update.sh to $tag"
			info "would commit: chore: release $tag [skip ci]"
		else
			set_json_version "$ROOT/package.json" "$next"
			set_json_version "$ROOT/apps/web/package.json" "$next"
			set_json_version "$ROOT/apps/landing/package.json" "$next"
			set_json_version "$ROOT/packages/server/package.json" "$next"
			pin_install_defaults "$tag"
			git add package.json apps/web/package.json apps/landing/package.json packages/server/package.json install.sh update.sh
			# --version equal to the current version edits nothing: skip the commit
			# instead of failing "nothing to commit" with a half-done tree.
			git diff --quiet --cached || git commit -m "$(cat <<EOF
chore: release ${tag} [skip ci]

EOF
)"
		fi
	else
		# Tag current version — still sync install defaults if they drifted.
		if [[ "$DRY_RUN" -eq 1 ]]; then
			info "would ensure install.sh / update.sh default to $tag"
		else
			pin_install_defaults "$tag"
			git add install.sh update.sh
			git diff --quiet --cached || git commit -m "$(cat <<EOF
chore: pin install defaults to ${tag} [skip ci]

EOF
)"
		fi
	fi

	run git tag "$tag"
	push_release "$tag"
	info "watch: https://github.com/bablilayoub/nixploy/actions/workflows/release.yml"
	info "page:   https://github.com/bablilayoub/nixploy/releases/tag/$tag"
}

release_cli() {
	local pkg="$ROOT/apps/cli/package.json"
	local current next tag
	current="$(read_version "$pkg")"
	if [[ -n "$SET_VERSION" ]]; then
		next="$SET_VERSION"
	elif [[ -n "$BUMP" ]]; then
		next="$(bump_semver "$current" "$BUMP")"
	else
		next="$current"
	fi
	tag="cli-v${next}"

	bold "CLI release → $tag (@nixploy/cli@$next)"
	info "apps/cli/package.json: $current → $next"
	info "Actions: only workflow Publish CLI (not CI / Docker / Release)"

	if git rev-parse "$tag" >/dev/null 2>&1; then
		die "tag $tag already exists locally"
	fi
	if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
		die "tag $tag already exists on origin"
	fi

	confirm "Create CLI release $tag?"
	run_checks

	if [[ "$next" != "$current" || -n "$BUMP" || -n "$SET_VERSION" ]]; then
		if [[ "$DRY_RUN" -eq 1 ]]; then
			info "would set apps/cli version to $next"
			info "would commit: chore(cli): release $tag [skip ci]"
		else
			set_json_version "$pkg" "$next"
			git add apps/cli/package.json
			git diff --quiet --cached || git commit -m "$(cat <<EOF
chore(cli): release ${tag} [skip ci]

EOF
)"
		fi
	fi

	run git tag "$tag"
	push_release "$tag"
	info "watch: https://github.com/bablilayoub/nixploy/actions/workflows/publish-cli.yml"
}

# ── main ─────────────────────────────────────────────────────────────────────
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" && "$DRY_RUN" -eq 0 ]]; then
	confirm "Not on main (on $branch). Continue anyway?"
fi

ensure_clean_enough

case "$TARGET" in
	paas) release_paas ;;
	cli) release_cli ;;
	both)
		# Capture bump/version for PaaS first; CLI needs its own bump independently.
		# For `both`, apply the same --bump/--version to each package separately
		# from that package's current version.
		release_paas
		# After PaaS commit, tree should be clean again for CLI.
		if [[ "$DRY_RUN" -eq 0 ]]; then
			ensure_clean_enough
		fi
		release_cli
		;;
esac

bold "Done"
[[ "$DRY_RUN" -eq 1 ]] && info "(dry-run — nothing pushed)"
