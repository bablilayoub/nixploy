#!/usr/bin/env bash
# Real-cosign coverage shared by PR CI and the post-sign Docker producer.
# $1 is the signed immutable index; $2 is an unsigned build manifest.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SIGNED_IMAGE="${1:?signed image digest required}"
UNSIGNED_IMAGE="${2:?unsigned image digest required}"
for ref in "$SIGNED_IMAGE" "$UNSIGNED_IMAGE"; do
	[[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "Expected an immutable digest: $ref" >&2; exit 1; }
done
[ "$SIGNED_IMAGE" != "$UNSIGNED_IMAGE" ] || { echo "Negative case must use a different artifact" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ -f "$tmp/cosign.log" ]; then cat "$tmp/cosign.log" >&2; fi; rm -rf "$tmp"; exit "$rc"' EXIT
export LOG_FILE="$tmp/cosign.log" NIXPLOY_CONFIG_DIR="$tmp/config"
for installer in install.sh update.sh; do
	export NIXPLOY_INSTALLER="$HERE/../../$installer"
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
