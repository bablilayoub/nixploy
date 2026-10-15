const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export const VOLUME_RESTORE_LOCK = ".nixploy-restore-lock";

function lockContext(root: string, token: string): string[] {
	if (!/^[a-f0-9]{24}$/.test(token)) throw new Error("Invalid restore staging token");
	return [
		"set -eu",
		`target=${sq(root)}`,
		`token=${sq(token)}`,
		`lock=${sq(`${root}/${VOLUME_RESTORE_LOCK}`)}`,
		'owns_lock() { [ -d "$lock" ] && [ ! -L "$lock" ] && [ -f "$lock/owner" ] && [ ! -L "$lock/owner" ] && [ "$(cat "$lock/owner")" = "$token" ]; }',
		'assert_owner() { owns_lock || { echo "Restore lock ownership changed; keep the service stopped and recover manually." >&2; return 1; }; }',
		'assert_no_recovery_trees() { for entry in "$1"/.nixploy-restore "$1"/.nixploy-restore-* "$1"/.nixploy-previous "$1"/.nixploy-previous-*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; [ "$entry" = "$lock" ] && continue; echo "Unrecovered restore data found at $entry; keep the service stopped and recover manually." >&2; return 1; done; }',
	];
}

/**
 * A filesystem fence shared by every process/instance targeting this volume.
 * Acquire uses a short helper before consumer checks. No expiry: a crashed
 * operation's marker and recovery trees require explicit manual recovery.
 */
export function buildVolumeRestoreLockScript(
	root: string,
	token: string,
	action: "acquire" | "activate" | "release",
): string {
	return [
		...lockContext(root, token),
		...(action === "acquire"
			? [
					"umask 077",
					'mkdir "$lock" || { echo "Volume restore is locked; keep the service stopped and inspect the existing restore marker before retrying." >&2; exit 1; }',
					'printf "%s\\n" "$token" > "$lock/owner"',
					'assert_no_recovery_trees "$target"',
				]
			: action === "activate"
				? ["assert_owner", 'assert_no_recovery_trees "$target"', 'mkdir "$lock/active"']
				: [
						"assert_owner",
						'assert_no_recovery_trees "$target"',
						'for entry in "$lock"/* "$lock"/.[!.]* "$lock"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; [ "$entry" = "$lock/owner" ] || { echo "Restore helper may still be active or recovery is incomplete; keep the service stopped and recover manually." >&2; exit 1; }; done',
						'rm "$lock/owner"; rmdir "$lock"',
					]),
	].join("; ");
}

/**
 * Replace a stopped volume while holding its pre-acquired fence. An active
 * marker prevents the caller releasing it while a detached helper is alive.
 * Failed rollback retains both trees and the fence for manual recovery.
 * This is not an atomic filesystem transaction under disk/host failure.
 */
export function buildVolumeReplacementScript(
	root: string,
	token: string,
	subtree?: "data",
): string {
	const staged = `${root}/.nixploy-restore-${token}`;
	const previous = `${root}/.nixploy-previous-${token}`;
	const payload = subtree ? `${staged}/${subtree}` : staged;
	return [
		...lockContext(root, token),
		`staged=${sq(staged)}`,
		`previous=${sq(previous)}`,
		`payload=${sq(payload)}`,
		"assert_owner",
		'assert_no_recovery_trees "$target"',
		// Do not install a cleanup trap until exclusive entry succeeds.
		'mkdir "$lock/active/entered" || { echo "A restore helper already owns this marker or it was not activated; keep the service stopped." >&2; exit 1; }',
		"phase=stage",
		'owner() { stat -c "%u:%g" "$1" 2>/dev/null || stat -f "%u:%g" "$1"; }',
		'mode() { stat -c "%a" "$1" 2>/dev/null || stat -f "%Lp" "$1"; }',
		'move_children() { for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; case "$entry" in "$staged"|"$previous"|"$lock") continue;; esac; mv "$entry" "$2"/ || return 1; done; }',
		'cleanup() { rc=$?; trap - EXIT HUP INT TERM; assert_owner || exit 1; cleaned=0; if [ "$phase" = stage ]; then if rm -rf "$staged" "$previous"; then cleaned=1; fi; elif [ "$phase" = old ] || [ "$phase" = new ]; then restored=1; if [ "$phase" = new ]; then move_children "$target" "$payload" || restored=0; fi; if [ "$restored" = 1 ]; then move_children "$previous" "$target" || restored=0; fi; if [ "$restored" = 1 ]; then chown "$old_owner" "$target" && chmod "$old_mode" "$target" || restored=0; fi; if [ "$restored" = 1 ] && rm -rf "$staged" "$previous"; then cleaned=1; else echo "Restore rollback failed; previous data retained at $previous and staged data at $staged. Keep the service stopped and recover manually." >&2; fi; else echo "Restore cleanup failed; inspect $previous before starting the service" >&2; fi; if [ "$cleaned" = 1 ]; then rmdir "$lock/active/entered" "$lock/active" || rc=1; fi; exit "$rc"; }',
		"trap cleanup EXIT",
		"trap 'exit 1' HUP INT TERM",
		'old_owner=$(owner "$target"); old_mode=$(mode "$target")',
		'mkdir "$staged" "$previous"',
		'tar xpzf - -C "$staged"',
		...(subtree ? ['test -f "$payload/dump.rdb"'] : []),
		'assert_no_recovery_trees "$payload"',
		'new_owner=$(owner "$payload"); new_mode=$(mode "$payload")',
		"assert_owner",
		"phase=old",
		'move_children "$target" "$previous"',
		"phase=new",
		'move_children "$payload" "$target"',
		'chown "$new_owner" "$target"; chmod "$new_mode" "$target"',
		"phase=done",
		'rm -rf "$staged" "$previous"',
		'rmdir "$lock/active/entered" "$lock/active"',
		"trap - EXIT HUP INT TERM",
	].join("; ");
}
