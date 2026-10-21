#!/usr/bin/env bash
# Real-cosign coverage shared by PR CI and the post-sign Docker producer.
# $1 is the signed immutable index; $2 is an unsigned build manifest.
# Optional $3 supplies pinned installer assets; helpers always come from this checkout.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$#" -le 3 ] || { echo "Usage: $0 SIGNED_IMAGE UNSIGNED_IMAGE [INSTALLER_DIRECTORY]" >&2; exit 1; }
SIGNED_IMAGE="${1:?signed image digest required}"
UNSIGNED_IMAGE="${2:?unsigned image digest required}"
INSTALLER_DIRECTORY="${3-${HERE}/../..}"
[ -d "$INSTALLER_DIRECTORY" ] || { echo "Missing installer directory: $INSTALLER_DIRECTORY" >&2; exit 1; }
INSTALLER_DIRECTORY="$(cd -- "$INSTALLER_DIRECTORY" && pwd)"
# Validate the complete asset set first. Never substitute this checkout's scripts
# for a missing or unsupported release asset and accidentally verify the wrong code.
for installer in install.sh update.sh; do
	asset="$INSTALLER_DIRECTORY/$installer"
	[ -f "$asset" ] && [ -r "$asset" ] || { echo "Missing installer asset: $asset" >&2; exit 1; }
	if ! grep -q '^# ── image signature' "$asset" || ! grep -q '^# ── end image signature' "$asset"; then
		echo "Unsupported installer asset: $asset has no complete image-signature block" >&2
		exit 1
	fi
done
for ref in "$SIGNED_IMAGE" "$UNSIGNED_IMAGE"; do
	[[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "Expected an immutable digest: $ref" >&2; exit 1; }
done
[ "$SIGNED_IMAGE" != "$UNSIGNED_IMAGE" ] || { echo "Negative case must use a different artifact" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ -f "$tmp/cosign.log" ]; then cat "$tmp/cosign.log" >&2; fi; rm -rf "$tmp"; exit "$rc"' EXIT
export LOG_FILE="$tmp/cosign.log" NIXPLOY_CONFIG_DIR="$tmp/config"
for installer in install.sh update.sh; do
	export NIXPLOY_INSTALLER="$INSTALLER_DIRECTORY/$installer"
	pinned="$("$HERE/verify-image-signature.sh" "$SIGNED_IMAGE" | tail -n 1)"
	[ "$pinned" = "$SIGNED_IMAGE" ] || { echo "$installer changed the signed digest" >&2; exit 1; }
	echo "$installer accepts $pinned"
	for negative in foreign unsigned; do
		: > "$LOG_FILE"
		image="$SIGNED_IMAGE"
		identity='^https://github\.com/someone-else/nixploy/'
		reason='failed to verify certificate identity'
		if [ "$negative" = unsigned ]; then
			image="$UNSIGNED_IMAGE"
			identity='^https://github\.com/bablilayoub/nixploy/\.github/workflows/(release|docker)\.yml@refs/'
			reason='no signatures found'
		fi
		rc=0
		NIXPLOY_SIGNING_IDENTITY_REGEXP="$identity" \
			"$HERE/verify-image-signature.sh" "$image" > "$tmp/result" 2>&1 || rc=$?
		# A missing script/binary or another shell failure is not a successful
		# negative case. Require the actual installer's signature rejection.
		if [ "$rc" -ne 1 ] || ! grep -q 'Signature check FAILED' "$tmp/result" || ! grep -q "$reason" "$LOG_FILE"; then
			cat "$tmp/result" >&2
			echo "$installer did not reject the $negative signature as expected (exit $rc)" >&2
			exit 1
		fi
		echo "$installer rejects $negative signature"
	done
done
