/**
 * Env vars are stored as `KEY=VALUE` lines (one per line, `#` comments
 * allowed). They inherit downward: project → environment → service,
 * with deeper levels overriding by key.
 */

/** Parse `KEY=VALUE` lines into entries, skipping blanks and comments. */
export function parseEnv(env: string | null | undefined): Array<[string, string]> {
	if (!env) return [];
	const entries: Array<[string, string]> = [];
	for (const rawLine of env.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		entries.push([line.slice(0, eq).trim(), line.slice(eq + 1)]);
	}
	return entries;
}

/** Merge env layers; later layers override earlier ones by key. */
export function mergeEnv(...layers: Array<string | null | undefined>): string {
	const map = new Map<string, string>();
	for (const layer of layers) {
		for (const [key, value] of parseEnv(layer)) {
			map.set(key, value);
		}
	}
	return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
}

/** Parse into the `KEY=VALUE` array docker expects. */
export function envToArray(env: string | null | undefined): string[] {
	return parseEnv(env).map(([k, v]) => `${k}=${v}`);
}
