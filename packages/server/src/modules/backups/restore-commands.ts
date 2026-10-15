const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Stage and replace a stopped volume's children. Old bytes stay on the same
 * volume until the complete new tree is in place. A failed move rolls back;
 * failed rollback retains both trees for manual recovery, never auto-starts.
 * This is not an atomic filesystem transaction under disk/host failure.
 */
export function buildVolumeReplacementScript(
	root: string,
	token: string,
	subtree?: "data",
): string {
	if (!/^[a-f0-9]{24}$/.test(token)) throw new Error("Invalid restore staging token");
	const staged = `${root}/.nixploy-restore-${token}`;
	const previous = `${root}/.nixploy-previous-${token}`;
	const payload = subtree ? `${staged}/${subtree}` : staged;
	return [
		"set -eu",
		`staged=${sq(staged)}`,
		`previous=${sq(previous)}`,
		`target=${sq(root)}`,
		`payload=${sq(payload)}`,
		"phase=stage",
		'owner() { stat -c "%u:%g" "$1" 2>/dev/null || stat -f "%u:%g" "$1"; }',
		'mode() { stat -c "%a" "$1" 2>/dev/null || stat -f "%Lp" "$1"; }',
		'old_owner=$(owner "$target"); old_mode=$(mode "$target")',
		'move_children() { for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$entry" ] || [ -L "$entry" ] || continue; case "$entry" in "$staged"|"$previous") continue;; esac; mv "$entry" "$2"/ || return 1; done; }',
		'cleanup() { rc=$?; trap - EXIT; if [ "$phase" = stage ]; then rm -rf "$staged" "$previous"; elif [ "$phase" = old ] || [ "$phase" = new ]; then restored=1; if [ "$phase" = new ]; then move_children "$target" "$payload" || restored=0; fi; if [ "$restored" = 1 ]; then move_children "$previous" "$target" || restored=0; fi; if [ "$restored" = 1 ]; then chown "$old_owner" "$target" && chmod "$old_mode" "$target" || restored=0; fi; if [ "$restored" = 1 ]; then rm -rf "$staged" "$previous"; else echo "Restore rollback failed; previous data retained at $previous and staged data at $staged. Keep the service stopped and recover manually." >&2; fi; else echo "Restore cleanup failed; inspect $previous before starting the service" >&2; fi; exit "$rc"; }',
		"trap cleanup EXIT",
		"trap 'exit 1' HUP INT TERM",
		'mkdir "$staged" "$previous"',
		'tar xpzf - -C "$staged"',
		...(subtree ? ['test -f "$payload/dump.rdb"'] : []),
		'new_owner=$(owner "$payload"); new_mode=$(mode "$payload")',
		"phase=old",
		'move_children "$target" "$previous"',
		"phase=new",
		'move_children "$payload" "$target"',
		'chown "$new_owner" "$target"; chmod "$new_mode" "$target"',
		"phase=done",
		'rm -rf "$staged" "$previous"',
		"trap - EXIT HUP INT TERM",
	].join("; ");
}
