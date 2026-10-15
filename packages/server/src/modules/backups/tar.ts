/**
 * BusyBox tar's verbose listing resolves PAX/GNU long names before printing.
 * Confined links are allowed; absolute/parent link targets are refused.
 * Normalizing links independently would miss escapes through link chains.
 */
export function assertSafeTarEntry(line: string, root?: string): void {
	const match =
		/^([-dl])[rwxStTs-]{9}\s+\S+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(.+)$/.exec(
			line,
		);
	if (!match)
		throw new Error(
			"Archive contains special files or an unsupported tar listing; restore it manually",
		);
	const parts = (match[2] ?? "").split(" -> ");
	if (parts.length > 2 || (match[1] === "l" && parts.length !== 2))
		throw new Error("Archive contains an ambiguous link");
	const name = parts[0] ?? "";
	if (
		name.startsWith("/") ||
		[...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
		name.split("/").includes("..")
	) {
		throw new Error("Archive contains an unsafe path");
	}
	const normalized = name.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
	if (root && normalized !== root && !normalized.startsWith(`${root}/`)) {
		throw new Error(`Archive must contain only the ${root}/ data subtree`);
	}
	if (parts.length === 2) {
		const target = parts[1] ?? "";
		if (
			!target ||
			target.startsWith("/") ||
			target.split("/").includes("..") ||
			[...target].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
		)
			throw new Error("Archive contains an unsafe link target");
		// BusyBox prints hard links as regular files with an arrow. Those
		// targets are archive-relative; symlink targets are entry-relative.
		if (root && match[1] === "-" && target.replace(/^(\.\/)+/, "").split("/")[0] !== root)
			throw new Error("Archive hard link leaves its data subtree");
	}
}
