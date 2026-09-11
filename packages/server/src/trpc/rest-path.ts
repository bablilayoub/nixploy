/**
 * Walk a dotted procedure path (`compose.rollback`, `template.sources.list`)
 * through a caller or router tree. The REST adapter, the CLI registry and MCP
 * all address procedures by these paths; nested routers are `a.b.c`, never
 * `a["b.c"]`, so every segment has to be walked — indexing once with the
 * remainder silently returns `undefined` for anything below the first level.
 */
export function walkProcedurePath<T = unknown>(root: unknown, path: string): T | undefined {
	if (!path) return undefined;
	let node: unknown = root;
	for (const segment of path.split(".")) {
		// tRPC callers are callable proxies (function targets), so accept both.
		if (
			segment === "" ||
			node === null ||
			(typeof node !== "object" && typeof node !== "function")
		) {
			return undefined;
		}
		node = (node as Record<string, unknown>)[segment];
		if (node === undefined) return undefined;
	}
	return node as T;
}
