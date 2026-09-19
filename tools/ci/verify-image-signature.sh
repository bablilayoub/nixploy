#!/usr/bin/env bash
# Exercise the installers' image-signature block on its own.
#
# Sources the "image signature" section shared by install.sh and update.sh
# (extracted by its markers, so this always tests the code that ships) with
# the few helpers it needs stubbed, then runs verify_app_image against the
# image in $1 (default: ghcr.io/bablilayoub/nixploy:main). Prints the pinned
# ref on success. Exit 1 when the signature does not verify.
#
# Used by the `installer-signature` CI job with a real cosign; locally it also
# runs with a fake cosign on PATH to check the plumbing without a download.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${NIXPLOY_INSTALLER:-${HERE}/../../install.sh}"
APP_IMAGE="${1:-ghcr.io/bablilayoub/nixploy:main}"
LOG_FILE="${LOG_FILE:-$(mktemp)}"
# shellcheck disable=SC2034  # read by the sourced block
HOST_CONFIG_DIR="${NIXPLOY_CONFIG_DIR:-$(mktemp -d)}"

need_cmd() { command -v "$1" >/dev/null 2>&1; }
ok()   { printf '   ok    %s\n' "$*"; }
info() { printf '   info  %s\n' "$*"; }
warn() { printf '   warn  %s\n' "$*" >&2; }
die()  { printf '   ERROR %s\n' "$*" >&2; exit 1; }

block="$(sed -n '/^# ── image signature/,/^# ── end image signature/p' "${SCRIPT}")"
[ -n "${block}" ] || die "no image-signature block found in ${SCRIPT}"
# shellcheck disable=SC1090
eval "${block}"

verify_app_image
printf '%s\n' "${APP_IMAGE}"
